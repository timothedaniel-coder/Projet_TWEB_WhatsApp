const util = require('util');
const net = require('net');
const { ACTIONS, createMessage, createError } = require('../common/protocol.js');

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

const server = net.createServer((socket) => {
    debug('CONNECTED from ' + socket.remoteAddress + ':' + socket.remotePort);
    
    let buffer = ''; 

    socket.on('data', function(data) {
        buffer += data.toString();
        
        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
            const messageStr = buffer.substring(0, boundary).trim();
            buffer = buffer.substring(boundary + 1);
            
            if (messageStr) {
                try {
                    const msg = JSON.parse(messageStr);
                    handleClientMessage(msg, socket);
                } catch (e) {
                    socket.write(createError('invalid-json', 'Format JSON invalide'));
                }
            }
            boundary = buffer.indexOf('\n');
        }
    });

    socket.on('close', () => {
        for (let [name, clientSocket] of connectedClients.entries()) {
            if (clientSocket === socket) {
                connectedClients.delete(name);
                debug(`Nettoyage : suppression de ${name}`);
                connectedClients.forEach((otherSocket) => {
                    otherSocket.write(createMessage(ACTIONS.SRV_LEFT, "serveur", { user: name }));
                });
                break;
            }
        }
    });

    socket.on('error', (err) => {
        debug(`Erreur réseau : ${err.message}`);
    });
});

function handleClientMessage(msg, socket) {
    const clientIdentity = msg.sender || msg.name; 
    debug(`Action reçue : ${msg.action} par ${clientIdentity}`);

    if (msg.action !== ACTIONS.HELLO && !connectedClients.has(clientIdentity)) {
        socket.write(createError('not-registered', 'Vous devez faire un hello d\'abord.'));
        return;
    }

    switch(msg.action){
        case ACTIONS.HELLO:
            if (connectedClients.has(msg.sender)) {
                socket.write(createError('already-registered', 'Pseudo déjà utilisé.'));
                return;
            }
            connectedClients.forEach((clientSocket) => {
                clientSocket.write(createMessage(ACTIONS.SRV_JOINED, "serveur", { user: msg.sender }));
            });
            connectedClients.set(msg.sender, socket);
            socket.write(createMessage(ACTIONS.SRV_HELLO, msg.sender, { msg: `Bienvenue ${msg.sender} !` }));
            break;  
            
        case ACTIONS.SEND:
            const destSocket = connectedClients.get(msg.dest);
            if (destSocket) {
                if (msg.sender === msg.dest) {
                    socket.write(createError('recipient-is-self', 'Vous ne pouvez pas vous envoyer de message.'));
                    return;
                }
                destSocket.write(createMessage(ACTIONS.SRV_SEND, msg.sender, { dest: msg.dest, msg: msg.msg }));
                socket.write(createMessage(ACTIONS.SRV_SEND_ACK, "serveur", { dest: msg.dest }));
            } else {
                socket.write(createError('recipient-not-found', `L'utilisateur ${msg.dest} n'est pas connecté.`));
            }
            break;
            
        case ACTIONS.BROADCAST:
            let count = 0;
            connectedClients.forEach((clientSocket, clientName) => {
                if (clientName !== msg.sender) {
                    clientSocket.write(createMessage(ACTIONS.SRV_BROADCAST, msg.sender, { msg: msg.msg }));
                    count++;
                }
            });
            socket.write(createMessage(ACTIONS.SRV_BROADCAST_ACK, "serveur", { count: count }));
            break;
            
        case ACTIONS.LIST:
            const users = Array.from(connectedClients.keys());
            socket.write(createMessage(ACTIONS.SRV_LIST, "serveur", { clients: users }));
            break;
            
        case ACTIONS.QUIT:
            socket.write(createMessage(ACTIONS.SRV_QUIT, "serveur", { msg: "Déconnexion confirmée." }));
            socket.end();
            break;
            
        case ACTIONS.CREATE_GROUP:
            if (!msg.group || typeof msg.group !== 'string') {
                socket.write(createError('invalid-message', 'Nom de groupe invalide.'));
                return;
            }
            if (groups.has(msg.group)) {
                socket.write(createError('already-exists', `Le groupe ${msg.group} existe déjà.`));
                return;
            }
            const newGroup = new Group(msg.group, msg.sender);
            groups.set(msg.group, newGroup);
            socket.write(createMessage('server-cgroupe', "serveur", { group: msg.group, msg: `Groupe ${msg.group} créé avec succès.` }));
            break;

        case ACTIONS.LIST_GROUPS:
            const groupNames = Array.from(groups.keys());
            socket.write(createMessage('server-groups', "serveur", { groups: groupNames }));
            break;

        case ACTIONS.JOIN_GROUP:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupToJoin = groups.get(msg.group);
            if (groupToJoin.members.has(msg.sender)) return socket.write(createError('already-member', 'Déjà membre.'));
            // Vérification du bannissement
            if (groupToJoin.banned.has(msg.sender)) return socket.write(createError('banned', 'Vous êtes banni de ce groupe.'));
            // Vérification de l'invitation
            if (!groupToJoin.invited.has(msg.sender)) return socket.write(createError('not-invited', 'Vous n\'êtes pas invité dans ce groupe.'));
            
            groupToJoin.invited.delete(msg.sender); // On consomme l'invitation
            groupToJoin.members.add(msg.sender);
            
            groupToJoin.members.forEach(member => {
                const memberSocket = connectedClients.get(member);
                if (memberSocket) memberSocket.write(createMessage('server-group-joined', "serveur", { group: msg.group, user: msg.sender }));
            });
            break;

        case ACTIONS.GROUP_MEMBERS:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupMembers = groups.get(msg.group);
            if (!groupMembers.members.has(msg.sender)) return socket.write(createError('not-member', 'Vous n\'êtes pas membre.'));
            
            socket.write(createMessage('server-members', "serveur", { group: msg.group, members: Array.from(groupMembers.members) }));
            break;

        case ACTIONS.LEAVE_GROUP:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupToLeave = groups.get(msg.group);
            if (!groupToLeave.members.has(msg.sender)) return socket.write(createError('not-member', 'Vous n\'êtes pas membre.'));
            
            groupToLeave.members.delete(msg.sender);
            
            socket.write(createMessage('server-group-left', "serveur", { group: msg.group, user: msg.sender, reason: 'leave' }));
            groupToLeave.members.forEach(member => {
                const memberSocket = connectedClients.get(member);
                if (memberSocket) memberSocket.write(createMessage('server-group-left', "serveur", { group: msg.group, user: msg.sender, reason: 'leave' }));
            });
            break;

        case ACTIONS.GROUP_BROADCAST:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const targetGroup = groups.get(msg.group);
            
            if (!targetGroup.members.has(msg.sender)) return socket.write(createError('not-member', 'Vous n\'êtes pas membre de ce groupe.'));
            
            targetGroup.messages.push({ sender: msg.sender, msg: msg.msg });
            
            let groupCount = 0;
            targetGroup.members.forEach(member => {
                if (member !== msg.sender) {
                    const memberSocket = connectedClients.get(member);
                    if (memberSocket) {
                        memberSocket.write(createMessage('server-gmessage', msg.sender, { group: msg.group, msg: msg.msg }));
                        groupCount++;
                    }
                }
            });
            
            socket.write(createMessage('server-gbroadcast', "serveur", { group: msg.group, count: groupCount }));
            break;

        case ACTIONS.GROUP_MESSAGES:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupHistory = groups.get(msg.group);
            
            if (!groupHistory.members.has(msg.sender)) return socket.write(createError('not-member', 'Vous n\'êtes pas membre.'));
            
            socket.write(createMessage('server-msgs', "serveur", { group: msg.group, msgs: groupHistory.messages }));
            break;
        
        case ACTIONS.INVITE:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupToInvite = groups.get(msg.group);
            
            // Le contrat impose que seul le créateur puisse inviter
            if (groupToInvite.creator !== msg.sender) return socket.write(createError('not-owner', 'Seul le propriétaire peut inviter.'));
            
            groupToInvite.invited.add(msg.user);
            
            // On notifie la cible si elle est en ligne
            const invitedSocket = connectedClients.get(msg.user);
            if (invitedSocket) {
                invitedSocket.write(createMessage('server-invited', msg.sender, { group: msg.group }));
            }
            break;

        case ACTIONS.KICK:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupToKick = groups.get(msg.group);
            if (groupToKick.creator !== msg.sender) return socket.write(createError('not-owner', 'Seul le propriétaire peut expulser.'));
            
            if (groupToKick.members.has(msg.user)) {
                groupToKick.members.delete(msg.user);
                
                const kickedSocket = connectedClients.get(msg.user);
                if (kickedSocket) kickedSocket.write(createMessage('server-kicked', msg.sender, { group: msg.group, reason: 'kick' }));
                
                groupToKick.members.forEach(member => {
                    const memberSocket = connectedClients.get(member);
                    if (memberSocket) memberSocket.write(createMessage('server-group-left', "serveur", { group: msg.group, user: msg.user, reason: 'kick' }));
                });
            }
            break;

        case ACTIONS.BAN:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupToBan = groups.get(msg.group);
            if (groupToBan.creator !== msg.sender) return socket.write(createError('not-owner', 'Seul le propriétaire peut bannir.'));
            
            groupToBan.banned.add(msg.user);
            if (groupToBan.members.has(msg.user)) {
                groupToBan.members.delete(msg.user);
                
                const bannedSocket = connectedClients.get(msg.user);
                if (bannedSocket) bannedSocket.write(createMessage('server-banned', msg.sender, { group: msg.group, reason: 'ban' }));
                
                groupToBan.members.forEach(member => {
                    const memberSocket = connectedClients.get(member);
                    if (memberSocket) memberSocket.write(createMessage('server-group-left', "serveur", { group: msg.group, user: msg.user, reason: 'ban' }));
                });
            }
            break;

        case ACTIONS.UNBAN:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupToUnban = groups.get(msg.group);
            if (groupToUnban.creator !== msg.sender) return socket.write(createError('not-owner', 'Seul le propriétaire peut débannir.'));
            
            groupToUnban.banned.delete(msg.user);
            const unbannedSocket = connectedClients.get(msg.user);
            if (unbannedSocket) unbannedSocket.write(createMessage('server-unbanned', msg.sender, { group: msg.group }));
            break;
        
        case ACTIONS.STATES:
            if (!groups.has(msg.group)) return socket.write(createError('group-not-found', 'Groupe introuvable.'));
            const groupState = groups.get(msg.group);
            
            // Le contrat réserve l'action states aux membres
            if (!groupState.members.has(msg.sender)) return socket.write(createError('not-member', 'Vous n\'êtes pas membre.'));
            
            socket.write(createMessage('server-states', "serveur", { 
                group: msg.group, 
                owner: groupState.creator,
                members: Array.from(groupState.members),
                invited: Array.from(groupState.invited),
                banned: Array.from(groupState.banned)
            }));
            break;

        default:
            socket.write(createError('unknown-action', 'Action non reconnue.'));
            break;
    }
}

server.listen(PORT, HOST, () => {
    debug(`Server listening on ${HOST}:${PORT}`);
}); 