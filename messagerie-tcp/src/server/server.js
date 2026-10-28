const util = require('util');
const debug = util.debuglog('server');
var net = require('net');
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const connectedClients = new Map();

var server = net.createServer((socket) => {
    debug('CONNECTED from ' + socket.remoteAddress + ':' + socket.remotePort);
    socket.on('data', function(data) {
        msg = JSON.parse(data);
        debug('DATA received from '+socket.remoteAddress + ':' + data);

        switch(msg.action){
            case 'client-connect':
                connectedClients.set(msg.sender, socket);
                debug(`Nouveau client enregistré : ${msg.sender}`);
                break;
                
            case 'client-hello':
                socket.write(JSON.stringify({
                    "sender": msg.sender,
                    "action": "server-hello",
                    "msg": `Bienvenue ${msg.sender} !`
                }));
                break;  
            case 'client-send':
                const destSocket = connectedClients.get(msg.dest);
                
                if (destSocket) {
                    destSocket.write(JSON.stringify({
                        "sender": msg.sender,
                        "action": "server-send",
                        "msg": `[Message de ${msg.sender}] : ${msg.msg}`
                    }));
                    debug(`Message relayé de ${msg.sender} vers ${msg.dest}`);
                } else {
                    socket.write(JSON.stringify({
                        "msg": `Erreur : L'utilisateur ${msg.dest} n'est pas connecté.`
                    }));
                }
                break;
            case 'client-broadcast':
                connectedClients.forEach((clientSocket, clientName) => {
                    // Optionnel : éviter de s'envoyer le message à soi-même
                    if (clientName !== msg.sender) {
                        clientSocket.write(JSON.stringify({
                            "sender": msg.sender,
                            "action": "server-broadcast",
                            "msg": `[Diffusion de ${msg.sender}] : ${msg.msg}`
                        }));
                    }
                });
                debug(`Message diffusé par ${msg.sender}`);
                break;
            case 'client-list-clients':
                // Extrait les noms (les clés) de la Map et les rejoint avec une virgule
                const users = Array.from(connectedClients.keys()).join(', ');
                
                socket.write(JSON.stringify({
                    "action": "server-list-clients",
                    "msg": `Utilisateurs connectés : ${users}`
                }));
                break;
        }
    });
}).listen(PORT, HOST, () => {
    debug(`Server listening on ${HOST}:${PORT}`);
});