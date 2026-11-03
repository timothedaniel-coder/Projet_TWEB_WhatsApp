const util = require('util');
const net = require('net');
const { ACTIONS, createMessage, createError } = require('../common/protocol.js');
const { initDatabase, saveMessage, getUserHistory } = require('./database.js');
const { register, login } = require('./auth.js');
const { generateKeyPair, deriveSessionKeys, encryptMessage, decryptMessage } = require('../common/crypto.js');

const debug = util.debuglog('server');
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const connectedClients = new Map();
const groups = new Map(); 

class Group {
    constructor(name, creator) {
        this.name = name;
        this.creator = creator;
        this.members = new Set();
        this.members.add(creator); // Le créateur est automatiquement membre
        this.invited = new Set();
        this.banned = new Set();
        this.messages = [];
    }
}

function sendToSocket(socket, payloadObject) {
    if (socket.session && socket.session.keys) {
        const { encKey, macKey } = socket.session.keys;
        const encryptedJson = encryptMessage(payloadObject, encKey, macKey, socket.session.seqOut);
        socket.session.seqOut++;
        socket.write(encryptedJson + '\n');
    } else {
        socket.write(JSON.stringify(payloadObject) + '\n');
    }
}

const server = net.createServer((socket) => {
    debug('CONNECTED from ' + socket.remoteAddress + ':' + socket.remotePort);
    
    // Contexte de session attaché à la connexion TCP
    socket.session = {
        ecdh: null,
        keys: null,
        seqIn: 0,
        seqOut: 0,
        user: null // Objet { id, name } une fois authentifié
    };

    let buffer = ''; 

    socket.on('data', function(data) {
        buffer += data.toString();

        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
            const messageStr = buffer.substring(0, boundary).trim();
            buffer = buffer.substring(boundary + 1);

            if (messageStr) {
                try {
                    let msg = JSON.parse(messageStr);

                    // 1. Étape non chiffrée : Handshake ECDH
                    if (msg.action === ACTIONS.KEY_EXCHANGE) {
                        handleKeyExchange(msg, socket);
                    } 
                    // 2. Échanges chiffrés obligatoire une fois les clés établies
                    else if (socket.session.keys) {
                        const decryptedMsg = decryptMessage(
                            messageStr,
                            socket.session.keys.encKey,
                            socket.session.keys.macKey,
                            socket.session.seqIn
                        );
                        socket.session.seqIn++;
                        handleClientMessage(decryptedMsg, socket);
                    } 
                    // 3. Tentative de communication sans handshake préalable
                    else {
                        socket.write(createError('sec-error', 'Handshake cryptographique requis.'));
                    }
                } catch (e) {
                    debug('Erreur de traitement :', e.message);
                    sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'invalid-msg', msg: e.message });
                }
            }
            boundary = buffer.indexOf('\n');
        }
    });

    socket.on('close', () => {
        if (socket.session.user) {
            const userName = socket.session.user.name;
            connectedClients.delete(userName);
            debug(`Nettoyage : suppression de ${userName}`);
            
            connectedClients.forEach((otherSocket) => {
                sendToSocket(otherSocket, { action: ACTIONS.SRV_LEFT, sender: "serveur", user: userName });
            });
        }
    });

    socket.on('error', (err) => {
        debug(`Erreur réseau : ${err.message}`);
    });
});

/**
 * Traite la négociation de clés ECDH
 */
function handleKeyExchange(msg, socket) {
    if (!msg.publicKey) {
        return socket.write(createError('invalid-key', 'Clé publique client manquante.'));
    }

    // Générer la paire ECDH serveur
    const serverKey = generateKeyPair();
    socket.session.ecdh = serverKey.ecdh;

    // Dériver les deux clés partagées (chiffrement + mac)
    socket.session.keys = deriveSessionKeys(serverKey.ecdh, msg.publicKey);

    // Répondre en clair avec la clé publique du serveur
    const response = {
        action: ACTIONS.SRV_KEY_EXCHANGE,
        publicKey: serverKey.publicKeyHex
    };
    socket.write(JSON.stringify(response) + '\n');
    debug('Handshake ECDH accompli avec succès.');
}

/**
 * Traite les commandes métier une fois la connexion chiffrée
 */
async function handleClientMessage(msg, socket) {
    const clientIdentity = socket.session.user ? socket.session.user.name : (msg.sender || msg.name);
    debug(`Action chiffrée reçue : ${msg.action} par ${clientIdentity}`);

    // Exiger l'authentification (LOGIN ou REGISTER) pour toutes les actions métier, sauf si déjà connecté
    const publicActions = [ACTIONS.REGISTER, ACTIONS.LOGIN, ACTIONS.HELLO];
    if (!publicActions.includes(msg.action) && !socket.session.user) {
        sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-authenticated', msg: 'Veuillez vous connecter avec register ou login d\'abord.' });
        return;
    }

    switch(msg.action) {
        // --- PARTIE 3 : AUTHENTIFICATION & HISTORIQUE ---
        case ACTIONS.REGISTER:
            try {
                const newUser = await register(msg.sender, msg.password);
                // 1. Déclarer le client comme connecté (auto-login après inscription)
                socket.session.user = newUser;
                connectedClients.set(newUser.name, socket);

                // 2. Notifier les autres utilisateurs
                connectedClients.forEach((clientSocket, name) => {
                    if (name !== newUser.name) {
                        sendToSocket(clientSocket, { action: ACTIONS.SRV_JOINED, sender: "serveur", user: newUser.name });
                    }
                });

                // 3. Confirmer à l'utilisateur
                sendToSocket(socket, { action: ACTIONS.SRV_AUTH_OK, sender: "serveur", msg: `Compte ${newUser.name} créé avec succès.` });
            } catch (err) {
                sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: err.code || 'reg-failed', msg: err.message });
            }
            break;

        case ACTIONS.LOGIN:
            try {
                const user = await login(msg.sender, msg.password);

                if (connectedClients.has(user.name)) {
                    sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'already-connected', msg: 'Compte déjà connecté ailleurs.' });
                    return;
                }

                socket.session.user = user;
                connectedClients.set(user.name, socket);

                // Notifier les autres utilisateurs
                connectedClients.forEach((clientSocket, name) => {
                    if (name !== user.name) {
                        sendToSocket(clientSocket, { action: ACTIONS.SRV_JOINED, sender: "serveur", user: user.name });
                    }
                });

                sendToSocket(socket, { action: ACTIONS.SRV_AUTH_OK, sender: user.name, msg: `Bienvenue ${user.name} !` });
            } catch (err) {
                sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: err.code || 'auth-failed', msg: err.message });
            }
            break;

        case ACTIONS.HISTORY:
            try {
                const history = await getUserHistory(socket.session.user.id);
                sendToSocket(socket, { action: ACTIONS.SRV_HISTORY, sender: "serveur", history: history });
            } catch (err) {
                sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'db-error', msg: err.message });
            }
            break;

        // --- PARTIE 1 : MESSAGERIE DE BASE ---
        case ACTIONS.HELLO:
            if (socket.session.user) {
                sendToSocket(socket, { action: ACTIONS.SRV_HELLO, sender: socket.session.user.name, msg: `Bonjour ${socket.session.user.name} !` });
            } else {
                sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'auth-required', msg: 'Utilisez client-login ou client-register.' });
            }
            break;

        case ACTIONS.SEND:
            const destSocket = connectedClients.get(msg.dest);
            if (destSocket) {
                if (socket.session.user.name === msg.dest) {
                    sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'recipient-is-self', msg: 'Vous ne pouvez pas vous envoyer de message.' });
                    return;
                }
                
                sendToSocket(destSocket, { action: ACTIONS.SRV_SEND, sender: socket.session.user.name, dest: msg.dest, msg: msg.msg });
                sendToSocket(socket, { action: ACTIONS.SRV_SEND_ACK, sender: "serveur", dest: msg.dest });
                await saveMessage(socket.session.user.id, 'private_sent', `À ${msg.dest}: ${msg.msg}`);
            } else {
                sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'recipient-not-found', msg: `L'utilisateur ${msg.dest} n'est pas connecté.` });
            }
            break;

        case ACTIONS.BROADCAST:
            let count = 0;
            connectedClients.forEach((clientSocket, clientName) => {
                if (clientName !== socket.session.user.name) {
                    sendToSocket(clientSocket, { action: ACTIONS.SRV_BROADCAST, sender: socket.session.user.name, msg: msg.msg });
                    count++;
                }
            });
            sendToSocket(socket, { action: ACTIONS.SRV_BROADCAST_ACK, sender: "serveur", count: count });
            await saveMessage(socket.session.user.id, 'broadcast', msg.msg);
            break;

        case ACTIONS.LIST:
            const users = Array.from(connectedClients.keys());
            sendToSocket(socket, { action: ACTIONS.SRV_LIST, sender: "serveur", clients: users });
            break;

        case ACTIONS.QUIT:
            sendToSocket(socket, { action: ACTIONS.SRV_QUIT, sender: "serveur", msg: "Déconnexion confirmée." });
            socket.end();
            break;

        // --- PARTIE 2 : GROUPES ---
        case ACTIONS.CREATE_GROUP:
            if (!msg.group || typeof msg.group !== 'string') {
                return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'invalid-message', msg: 'Nom de groupe invalide.' });
            }
            if (groups.has(msg.group)) {
                return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'already-exists', msg: `Le groupe ${msg.group} existe déjà.` });
            }
            const newGroup = new Group(msg.group, socket.session.user.name);
            groups.set(msg.group, newGroup);
            sendToSocket(socket, { action: 'server-cgroupe', sender: "serveur", group: msg.group, msg: `Groupe ${msg.group} créé avec succès.` });
            break;

        case ACTIONS.LIST_GROUPS:
            const groupNames = Array.from(groups.keys());
            sendToSocket(socket, { action: 'server-groups', sender: "serveur", groups: groupNames });
            break;

        case ACTIONS.JOIN_GROUP:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupToJoin = groups.get(msg.group);
            if (groupToJoin.members.has(socket.session.user.name)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'already-member', msg: 'Déjà membre.' });
            if (groupToJoin.banned.has(socket.session.user.name)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'banned', msg: 'Vous êtes banni de ce groupe.' });
            if (!groupToJoin.invited.has(socket.session.user.name)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-invited', msg: 'Vous n\'êtes pas invité dans ce groupe.' });
            
            groupToJoin.invited.delete(socket.session.user.name);
            groupToJoin.members.add(socket.session.user.name);
            
            groupToJoin.members.forEach(member => {
                const memberSocket = connectedClients.get(member);
                if (memberSocket) sendToSocket(memberSocket, { action: 'server-group-joined', sender: "serveur", group: msg.group, user: socket.session.user.name });
            });
            break;

        case ACTIONS.GROUP_MEMBERS:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupMembers = groups.get(msg.group);
            if (!groupMembers.members.has(socket.session.user.name)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-member', msg: 'Vous n\'êtes pas membre.' });
            
            sendToSocket(socket, { action: 'server-members', sender: "serveur", group: msg.group, members: Array.from(groupMembers.members) });
            break;

        case ACTIONS.LEAVE_GROUP:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupToLeave = groups.get(msg.group);
            if (!groupToLeave.members.has(socket.session.user.name)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-member', msg: 'Vous n\'êtes pas membre.' });
            
            groupToLeave.members.delete(socket.session.user.name);
            sendToSocket(socket, { action: 'server-group-left', sender: "serveur", group: msg.group, user: socket.session.user.name, reason: 'leave' });
            
            groupToLeave.members.forEach(member => {
                const memberSocket = connectedClients.get(member);
                if (memberSocket) sendToSocket(memberSocket, { action: 'server-group-left', sender: "serveur", group: msg.group, user: socket.session.user.name, reason: 'leave' });
            });
            break;

        case ACTIONS.GROUP_BROADCAST:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const targetGroup = groups.get(msg.group);
            
            if (!targetGroup.members.has(socket.session.user.name)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-member', msg: 'Vous n\'êtes pas membre de ce groupe.' });
            
            targetGroup.messages.push({ sender: socket.session.user.name, msg: msg.msg });
            
            let groupCount = 0;
            targetGroup.members.forEach(member => {
                if (member !== socket.session.user.name) {
                    const memberSocket = connectedClients.get(member);
                    if (memberSocket) {
                        sendToSocket(memberSocket, { action: 'server-gmessage', sender: socket.session.user.name, group: msg.group, msg: msg.msg });
                        groupCount++;
                    }
                }
            });
            sendToSocket(socket, { action: 'server-gbroadcast', sender: "serveur", group: msg.group, count: groupCount });
            break;

        case ACTIONS.GROUP_MESSAGES:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupHistory = groups.get(msg.group);
            if (!groupHistory.members.has(socket.session.user.name)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-member', msg: 'Vous n\'êtes pas membre.' });
            
            sendToSocket(socket, { action: 'server-msgs', sender: "serveur", group: msg.group, msgs: groupHistory.messages });
            break;
        
        case ACTIONS.INVITE:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupToInvite = groups.get(msg.group);
            
            if (groupToInvite.creator !== socket.session.user.name) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-owner', msg: 'Seul le propriétaire peut inviter.' });
            
            groupToInvite.invited.add(msg.user);
            const invitedSocket = connectedClients.get(msg.user);
            if (invitedSocket) sendToSocket(invitedSocket, { action: 'server-invited', sender: socket.session.user.name, group: msg.group });
            break;

        case ACTIONS.KICK:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupToKick = groups.get(msg.group);
            if (groupToKick.creator !== socket.session.user.name) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-owner', msg: 'Seul le propriétaire peut expulser.' });
            
            if (groupToKick.members.has(msg.user)) {
                groupToKick.members.delete(msg.user);
                
                const kickedSocket = connectedClients.get(msg.user);
                if (kickedSocket) sendToSocket(kickedSocket, { action: 'server-kicked', sender: socket.session.user.name, group: msg.group, reason: 'kick' });
                
                groupToKick.members.forEach(member => {
                    const memberSocket = connectedClients.get(member);
                    if (memberSocket) sendToSocket(memberSocket, { action: 'server-group-left', sender: "serveur", group: msg.group, user: msg.user, reason: 'kick' });
                });
            }
            break;

        case ACTIONS.BAN:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupToBan = groups.get(msg.group);
            if (groupToBan.creator !== socket.session.user.name) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-owner', msg: 'Seul le propriétaire peut bannir.' });
            
            groupToBan.banned.add(msg.user);
            if (groupToBan.members.has(msg.user)) {
                groupToBan.members.delete(msg.user);
                
                const bannedSocket = connectedClients.get(msg.user);
                if (bannedSocket) sendToSocket(bannedSocket, { action: 'server-banned', sender: socket.session.user.name, group: msg.group, reason: 'ban' });
                
                groupToBan.members.forEach(member => {
                    const memberSocket = connectedClients.get(member);
                    if (memberSocket) sendToSocket(memberSocket, { action: 'server-group-left', sender: "serveur", group: msg.group, user: msg.user, reason: 'ban' });
                });
            }
            break;

        case ACTIONS.UNBAN:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupToUnban = groups.get(msg.group);
            if (groupToUnban.creator !== socket.session.user.name) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-owner', msg: 'Seul le propriétaire peut débannir.' });
            
            groupToUnban.banned.delete(msg.user);
            const unbannedSocket = connectedClients.get(msg.user);
            if (unbannedSocket) sendToSocket(unbannedSocket, { action: 'server-unbanned', sender: socket.session.user.name, group: msg.group });
            break;
        
        case ACTIONS.STATES:
            if (!groups.has(msg.group)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'group-not-found', msg: 'Groupe introuvable.' });
            const groupState = groups.get(msg.group);
            if (!groupState.members.has(socket.session.user.name)) return sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'not-member', msg: 'Vous n\'êtes pas membre.' });
            
            sendToSocket(socket, { action: 'server-states', sender: "serveur", group: msg.group, owner: groupState.creator, members: Array.from(groupState.members), invited: Array.from(groupState.invited), banned: Array.from(groupState.banned) });
            break;

        default:
            sendToSocket(socket, { action: ACTIONS.SRV_ERROR, code: 'unknown-action', msg: 'Action non reconnue.' });
            break;
    }
}

initDatabase()
  .then(() => {
    debug('Base de données initialisée avec succès.');
    server.listen(PORT, HOST, () => {
      debug(`Server listening on ${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erreur lors de l\'initialisation de la BDD :', err);
  });