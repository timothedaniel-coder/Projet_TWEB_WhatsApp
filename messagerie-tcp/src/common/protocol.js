// 1. Module des constantes (Types de messages)
const ACTIONS = {
    CONNECT: 'client-connect',
    HELLO: 'client-hello',
    SEND: 'client-send',
    BROADCAST: 'client-broadcast',
    LIST: 'client-list-clients',
    QUIT: 'client-quit',
    // Événements serveur
    SRV_HELLO: 'server-hello',
    SRV_SEND: 'server-send',
    SRV_BROADCAST: 'server-broadcast',
    SRV_LIST: 'server-list-clients',
    SRV_JOIN: 'server-event-join',
    SRV_LEAVE: 'server-event-leave'
};

// 2. Module de construction des messages
function createMessage(action, sender, msg = undefined, dest = undefined) {
    const payload = { action, sender };
    if (msg) payload.msg = msg;
    if (dest) payload.dest = dest;
    return JSON.stringify(payload);
}

// 3. Module des commandes utilisateurs
const COMMANDS = {
    QUIT: 'q;',
    LIST: 'ls;',
    BROADCAST: 'b;',
    SEND: 's;',
    HELLO: 'hello'
};

module.exports = { ACTIONS, createMessage, COMMANDS };