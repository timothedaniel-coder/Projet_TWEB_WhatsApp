// 1. Module des constantes (Types de messages imposés par le contrat)
const ACTIONS = {
    // ---- PARTIE 1 ----
    HELLO: 'client-hello',
    SEND: 'client-send',
    BROADCAST: 'client-broadcast',
    LIST: 'client-list-clients',
    QUIT: 'client-quit',
    
    SRV_HELLO: 'server-hello',
    SRV_SEND_ACK: 'server-send-ack',
    SRV_BROADCAST_ACK: 'server-broadcast-ack',
    SRV_LIST: 'server-list-clients',
    SRV_JOINED: 'server-user-joined',
    SRV_SEND: 'server-send',
    SRV_BROADCAST: 'server-broadcast',
    SRV_QUIT: 'server-quit',
    SRV_LEFT: 'server-user-left',
    SRV_ERROR: 'server-error',

    // ---- PARTIE 2 ----
    CREATE_GROUP: 'cgroupe',
    JOIN_GROUP: 'join',
    GROUP_BROADCAST: 'gbroadcast',
    GROUP_MEMBERS: 'members',
    GROUP_MESSAGES: 'msgs',
    LIST_GROUPS: 'groups',
    LEAVE_GROUP: 'leave',
    INVITE: 'invite',
    KICK: 'kick',
    BAN: 'ban',
    UNBAN: 'unban',
    STATES: 'states',

    // ---- PARTIE 3 ----
    KEY_EXCHANGE: 'client-key-exchange',  // Envoi de la clé publique ECDH client
    SRV_KEY_EXCHANGE: 'server-key-exchange', // Réponse avec clé publique ECDH serveur
    REGISTER: 'client-register',           // Inscription (pseudo + mot de passe)
    LOGIN: 'client-login',                 // Connexion (pseudo + mot de passe)
    SRV_AUTH_OK: 'server-auth-ok',         // Validation de l'authentification
    HISTORY: 'client-history',             // Demande de l'historique
    SRV_HISTORY: 'server-history'          // Envoi de l'historique
};

// 2. Module de construction des messages
function createMessage(action, sender, extraFields = {}) {
    // Le contrat demande d'utiliser "name" au lieu de "sender" pour la requête "groups"
    const payload = action === ACTIONS.LIST_GROUPS 
        ? { action, name: sender, ...extraFields }
        : { action, sender, ...extraFields };
    
    // Ajout du délimiteur \n imposé par le contrat pour le cadrage TCP
    return JSON.stringify(payload) + '\n';
}

// Fonction pour respecter le format d'erreur du contrat
function createError(code, msg) {
    return JSON.stringify({ action: ACTIONS.SRV_ERROR, code, msg }) + '\n';
}

// 3. Module des commandes utilisateurs
const COMMANDS = {
    QUIT: 'quit;',
    LIST: 'ls;',
    BROADCAST: 'b;',
    SEND: 'send;',
    HELLO: 'hello',
    // Commandes Partie 2
    CREATE_GROUP: 'cg;',
    JOIN_GROUP: 'join;',
    GROUP_BROADCAST: 'gbroadcast;',
    GROUPS: 'groups;',
    GROUP_MEMBERS: 'members;',
    LEAVE_GROUP: 'leave;',
    GROUP_MESSAGES: 'msgs;',
    INVITE: 'invite;',
    INVITE: 'invite;',
    KICK: 'kick;',
    BAN: 'ban;',
    UNBAN: 'unban;',
    STATES: 'states;',

    // Commandes Partie 3
    REGISTER: 'register;',
    LOGIN: 'login;',
    HISTORY: 'history;'
};

module.exports = { ACTIONS, createMessage, createError, COMMANDS };