const util = require('util');
const net = require('net');
// Importation du module commun
const { ACTIONS, createMessage } = require('../common/protocol.js');

const debug = util.debuglog('server');
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const connectedClients = new Map();

const server = net.createServer((socket) => {
    debug('CONNECTED from ' + socket.remoteAddress + ':' + socket.remotePort);
    
    socket.on('data', function(data) {
        const msg = JSON.parse(data);
        debug('DATA received from ' + socket.remoteAddress + ':' + data);

        switch(msg.action){
            case ACTIONS.CONNECT:
                connectedClients.forEach((clientSocket) => {
                    clientSocket.write(createMessage(ACTIONS.SRV_JOIN, "serveur", `${msg.sender} a rejoint le serveur.`));
                });
                connectedClients.set(msg.sender, socket);
                debug(`Nouveau client enregistré : ${msg.sender}`);
                break;
                
            case ACTIONS.HELLO:
                socket.write(createMessage(ACTIONS.SRV_HELLO, msg.sender, `Bienvenue ${msg.sender} !`));
                break;  
                
            case ACTIONS.SEND:
                const destSocket = connectedClients.get(msg.dest);
                if (destSocket) {
                    destSocket.write(createMessage(ACTIONS.SRV_SEND, msg.sender, `[Message de ${msg.sender}] : ${msg.msg}`));
                    debug(`Message relayé de ${msg.sender} vers ${msg.dest}`);
                } else {
                    socket.write(createMessage(ACTIONS.SRV_SEND, "serveur", `Erreur : L'utilisateur ${msg.dest} n'est pas connecté.`));
                }
                break;
                
            case ACTIONS.BROADCAST:
                connectedClients.forEach((clientSocket, clientName) => {
                    if (clientName !== msg.sender) {
                        clientSocket.write(createMessage(ACTIONS.SRV_BROADCAST, msg.sender, `[Diffusion de ${msg.sender}] : ${msg.msg}`));
                    }
                });
                debug(`Message diffusé par ${msg.sender}`);
                break;
                
            case ACTIONS.LIST:
                const users = Array.from(connectedClients.keys()).join(', ');
                socket.write(createMessage(ACTIONS.SRV_LIST, "serveur", `Utilisateurs connectés : ${users}`));
                break;
                
            case ACTIONS.QUIT:
                connectedClients.delete(msg.sender);
                debug(`Client déconnecté volontairement : ${msg.sender}`);
                connectedClients.forEach((clientSocket) => {
                    clientSocket.write(createMessage(ACTIONS.SRV_LEAVE, "serveur", `${msg.sender} a quitté le serveur.`));
                });
                break;
        }
    });

    socket.on('close', () => {
        for (let [name, clientSocket] of connectedClients.entries()) {
            if (clientSocket === socket) {
                connectedClients.delete(name);
                debug(`Nettoyage automatique : suppression de ${name}`);
                connectedClients.forEach((otherSocket) => {
                    otherSocket.write(createMessage(ACTIONS.SRV_LEAVE, "serveur", `${name} a été déconnecté.`));
                });
                break;
            }
        }
    });

    socket.on('error', (err) => {
        debug(`Erreur réseau sur une socket : ${err.message}`);
    });

}).listen(PORT, HOST, () => {
    debug(`Server listening on ${HOST}:${PORT}`);
});