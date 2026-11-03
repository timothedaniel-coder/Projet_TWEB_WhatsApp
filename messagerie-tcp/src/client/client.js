const chalk = require('chalk');
const util = require('util');
const net = require('net');
const readline = require('readline');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { ACTIONS, createMessage, COMMANDS } = require('../common/protocol.js');
const { generateKeyPair, deriveSessionKeys, encryptMessage, decryptMessage } = require('../common/crypto.js');

const debug = util.debuglog('client');
const argv = yargs(hideBin(process.argv)).argv;
const client = new net.Socket();
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.magenta('> ')
});

// État de la session cryptographique du client
const session = {
    ecdh: null,
    keys: null,
    seqIn: 0,
    seqOut: 0
};

// 1. Initialisation de la connexion et envoi de la clé publique ECDH (non chiffré)
client.connect(PORT, HOST, function() {
    console.log(chalk.green.bold('Connecté au serveur TCP.'));
    
    // Génération de la paire de clés ECDH côté client
    const keyPair = generateKeyPair();
    session.ecdh = keyPair.ecdh;
    
    // Envoi de la requête KEY_EXCHANGE
    console.log(chalk.gray('Négociation des clés de chiffrement en cours...'));
    const payload = { action: ACTIONS.KEY_EXCHANGE, publicKey: keyPair.publicKeyHex };
    client.write(JSON.stringify(payload) + '\n');
});

/**
 * Fonction utilitaire pour envoyer un message chiffré au serveur.
 */
function sendToServer(action, extraFields = {}) {
    const payload = { action, sender: argv.name, ...extraFields };
    
    if (session.keys) {
        // Envoi chiffré si le handshake est terminé
        const encryptedJson = encryptMessage(payload, session.keys.encKey, session.keys.macKey, session.seqOut);
        session.seqOut++;
        client.write(encryptedJson + '\n');
    } else {
        // Envoi en clair (uniquement pendant le handshake)
        client.write(JSON.stringify(payload) + '\n');
    }
}

let buffer = '';

client.on('data', function(data) {
    buffer += data.toString();
    
    let boundary = buffer.indexOf('\n');
    while (boundary !== -1) {
        const messageStr = buffer.substring(0, boundary).trim();
        buffer = buffer.substring(boundary + 1);
        
        if (messageStr) {
            try {
                let parsedData;
                
                // 2. Interception de la réponse serveur (Handshake)
                if (!session.keys) {
                    parsedData = JSON.parse(messageStr);
                    if (parsedData.action === ACTIONS.SRV_KEY_EXCHANGE) {
                        session.keys = deriveSessionKeys(session.ecdh, parsedData.publicKey);
                        console.log(chalk.green.bold('Canal sécurisé établi avec succès !'));
                        console.log(chalk.yellow('Veuillez vous inscrire (register;votremotdepasse) ou vous connecter (login;votremotdepasse).'));
                        rl.prompt();
                    } else if (parsedData.action === ACTIONS.SRV_ERROR) {
                        console.log(chalk.red(`Erreur serveur : ${parsedData.msg}`));
                    }
                } 
                // 3. Déchiffrement de tous les messages suivants
                else {
                    parsedData = decryptMessage(messageStr, session.keys.encKey, session.keys.macKey, session.seqIn);
                    session.seqIn++;
                }

                if (!parsedData || parsedData.action === ACTIONS.SRV_KEY_EXCHANGE) {
                    boundary = buffer.indexOf('\n');
                    continue;
                }

                process.stdout.clearLine();
                process.stdout.cursorTo(0);
                
                switch (parsedData.action) {
                    case ACTIONS.SRV_AUTH_OK:
                        console.log(chalk.green.bold(parsedData.msg));
                        break;
                    case ACTIONS.SRV_HISTORY:
                        console.log(chalk.cyan(`\n--- Votre Historique ---`));
                        if (parsedData.history && parsedData.history.length > 0) {
                            parsedData.history.forEach(m => {
                                console.log(chalk.cyan(`[${m.created_at}] ${m.kind} : ${m.body}`));
                            });
                        } else {
                            console.log(chalk.gray('Aucun historique.'));
                        }
                        console.log(chalk.cyan(`------------------------\n`));
                        break;
                    case ACTIONS.SRV_JOINED:
                        console.log(chalk.yellow(`${parsedData.user} s'est connecté.`));
                        break;
                    case ACTIONS.SRV_LEFT:
                        console.log(chalk.yellow(`${parsedData.user} s'est déconnecté.`));
                        break;
                    case ACTIONS.SRV_SEND_ACK:
                        console.log(chalk.gray(`Message bien envoyé à ${parsedData.dest}.`));
                        break;
                    case ACTIONS.SRV_BROADCAST_ACK:
                        console.log(chalk.gray(`Message diffusé à ${parsedData.count} personne(s).`));
                        break;
                    case ACTIONS.SRV_ERROR:
                        console.log(chalk.red(`Erreur (${parsedData.code}): ${parsedData.msg}`));
                        break;
                    case ACTIONS.SRV_LIST:
                        console.log(chalk.cyan(`Utilisateurs connectés : ${parsedData.clients.join(', ')}`));
                        break;
                    case ACTIONS.SRV_SEND:
                        console.log(chalk.cyan(`[Message privé de ${parsedData.sender}] : ${parsedData.msg}`));
                        break;
                    case ACTIONS.SRV_BROADCAST:
                        console.log(chalk.cyan(`[Diffusion de ${parsedData.sender}] : ${parsedData.msg}`));
                        break;

                    // --- PARTIE 2 : Groupes ---
                    case 'server-cgroupe':
                        console.log(chalk.green(`${parsedData.msg}`));
                        break;
                    case 'server-groups':
                        const list = parsedData.groups && parsedData.groups.length > 0 ? parsedData.groups.join(', ') : 'Aucun groupe';
                        console.log(chalk.cyan(`Groupes existants : ${list}`));
                        break;
                    case 'server-group-joined':
                        console.log(chalk.magenta(`${parsedData.user} a rejoint le groupe ${parsedData.group}.`));
                        break;
                    case 'server-group-left':
                        console.log(chalk.magenta(`${parsedData.user} a quitté le groupe ${parsedData.group} (${parsedData.reason}).`));
                        break;
                    case 'server-members':
                        console.log(chalk.cyan(`Membres de ${parsedData.group} : ${parsedData.members.join(', ')}`));
                        break;
                    case 'server-gmessage':
                        console.log(chalk.cyan(`[Groupe ${parsedData.group}] Message de ${parsedData.sender} : ${parsedData.msg}`));
                        break;
                    case 'server-gbroadcast':
                        console.log(chalk.gray(`Message diffusé au groupe ${parsedData.group} (${parsedData.count} personne(s)).`));
                        break;
                    case 'server-msgs':
                        console.log(chalk.cyan(`\n--- Historique du groupe ${parsedData.group} ---`));
                        if (parsedData.msgs && parsedData.msgs.length > 0) {
                            parsedData.msgs.forEach(m => {
                                console.log(chalk.cyan(`[${m.sender}] : ${m.msg}`));
                            });
                        } else {
                            console.log(chalk.gray('Aucun message dans ce groupe.'));
                        }
                        console.log(chalk.cyan(`-------------------------------------\n`));
                        break;
                    case 'server-invited':
                        console.log(chalk.magenta(`${parsedData.sender} vous a invité à rejoindre le groupe ${parsedData.group}. (Tapez join;${parsedData.group})`));
                        break;
                    case 'server-kicked':
                        console.log(chalk.red(`Vous avez été expulsé du groupe ${parsedData.group} par ${parsedData.sender}.`));
                        break;
                    case 'server-banned':
                        console.log(chalk.red(`Vous avez été banni du groupe ${parsedData.group} par ${parsedData.sender}.`));
                        break;
                    case 'server-unbanned':
                        console.log(chalk.green(`${parsedData.sender} a levé votre bannissement du groupe ${parsedData.group}.`));
                        break;
                    case 'server-states':
                        console.log(chalk.cyan(`\n--- État du groupe ${parsedData.group} ---`));
                        console.log(chalk.cyan(`Propriétaire : ${parsedData.owner}`));
                        console.log(chalk.cyan(`Membres      : ${parsedData.members.join(', ')}`));
                        if (parsedData.invited && parsedData.invited.length > 0) {
                            console.log(chalk.cyan(`Invités      : ${parsedData.invited.join(', ')}`));
                        }
                        if (parsedData.banned && parsedData.banned.length > 0) {
                            console.log(chalk.red(`Bannis       : ${parsedData.banned.join(', ')}`));
                        }
                        console.log(chalk.cyan(`-------------------------------------\n`));
                        break;
                    
                    default:
                        if (parsedData.msg) console.log(chalk.cyan(parsedData.msg));
                        break;
                }
            } catch (e) {
                debug('Erreur ou échec de déchiffrement : ' + e.message);
            }
        }
        boundary = buffer.indexOf('\n');
    }
    rl.prompt();
});

// Traitement des commandes de l'utilisateur (on utilise sendToServer pour chiffrer l'envoi)
rl.on('line', (line) => {
    const text = line.trim();
    
    // --- PARTIE 3 : Commandes d'authentification ---
    if (text.startsWith(COMMANDS.REGISTER)) {
        const password = text.substring(COMMANDS.REGISTER.length).trim();
        if (password) sendToServer(ACTIONS.REGISTER, { password });
        else console.log(chalk.red('Format attendu: register;motdepasse'));
    }
    else if (text.startsWith(COMMANDS.LOGIN)) {
        const password = text.substring(COMMANDS.LOGIN.length).trim();
        if (password) sendToServer(ACTIONS.LOGIN, { password });
        else console.log(chalk.red('Format attendu: login;motdepasse'));
    }
    else if (text === COMMANDS.HISTORY) {
        sendToServer(ACTIONS.HISTORY);
    }
    // --- Commandes historiques (Partie 1 et 2) ---
    else if (text === COMMANDS.HELLO) {
        sendToServer(ACTIONS.HELLO);
    } 
    else if (text.startsWith(COMMANDS.SEND)) {
        const parts = text.split(';');         
        if (parts.length >= 3) {
            sendToServer(ACTIONS.SEND, { msg: parts.slice(2).join(';'), dest: parts[1] });
        } else {
            console.log(chalk.red('Format attendu: send;destinataire;message'));
        }
    }
    else if (text.startsWith(COMMANDS.BROADCAST)) {
        const message = text.substring(COMMANDS.BROADCAST.length);
        sendToServer(ACTIONS.BROADCAST, { msg: message });
    }
    else if (text === COMMANDS.LIST) {
        sendToServer(ACTIONS.LIST);
    }
    else if (text.startsWith(COMMANDS.CREATE_GROUP)) {
        const groupName = text.substring(COMMANDS.CREATE_GROUP.length).trim();
        if (groupName) sendToServer(ACTIONS.CREATE_GROUP, { group: groupName });
    }
    else if (text === COMMANDS.GROUPS) {
        sendToServer(ACTIONS.LIST_GROUPS);
    }
    else if (text.startsWith(COMMANDS.JOIN_GROUP)) {
        sendToServer(ACTIONS.JOIN_GROUP, { group: text.substring(COMMANDS.JOIN_GROUP.length).trim() });
    }
    else if (text.startsWith(COMMANDS.GROUP_MEMBERS)) {
        sendToServer(ACTIONS.GROUP_MEMBERS, { group: text.substring(COMMANDS.GROUP_MEMBERS.length).trim() });
    }
    else if (text.startsWith(COMMANDS.LEAVE_GROUP)) {
        sendToServer(ACTIONS.LEAVE_GROUP, { group: text.substring(COMMANDS.LEAVE_GROUP.length).trim() });
    }
    else if (text.startsWith(COMMANDS.GROUP_BROADCAST)) {
        const parts = text.split(';');         
        if (parts.length >= 3) sendToServer(ACTIONS.GROUP_BROADCAST, { group: parts[1], msg: parts.slice(2).join(';') });
    }
    else if (text.startsWith(COMMANDS.GROUP_MESSAGES)) {
        sendToServer(ACTIONS.GROUP_MESSAGES, { group: text.substring(COMMANDS.GROUP_MESSAGES.length).trim() });
    }
    else if (text.startsWith(COMMANDS.INVITE)) {
        const parts = text.split(';');         
        if (parts.length >= 3) sendToServer(ACTIONS.INVITE, { group: parts[1], user: parts[2] });
    }
    else if (text.startsWith(COMMANDS.KICK) || text.startsWith(COMMANDS.BAN) || text.startsWith(COMMANDS.UNBAN)) {
        const parts = text.split(';');
        if (parts.length >= 3) {
            let action = text.startsWith(COMMANDS.KICK) ? ACTIONS.KICK 
                       : text.startsWith(COMMANDS.BAN) ? ACTIONS.BAN : ACTIONS.UNBAN;
            sendToServer(action, { group: parts[1], user: parts[2] });
        }
    }
    else if (text.startsWith(COMMANDS.STATES)) {
        sendToServer(ACTIONS.STATES, { group: text.substring(COMMANDS.STATES.length).trim() });
    }
    else if (text === COMMANDS.QUIT) {
        sendToServer(ACTIONS.QUIT);
        client.end();
        process.exit(0);
    }
    rl.prompt();
});