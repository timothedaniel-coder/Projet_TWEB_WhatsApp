const util = require('util');
const debug = util.debuglog('server');
var net = require('net');
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';

var server = net.createServer((socket) => {
    debug('CONNECTED from ' + socket.remoteAddress + ':' + socket.remotePort);
    socket.on('data', function(data) {
        msg = JSON.parse(data);
        debug('DATA received from '+socket.remoteAddress + ':' + data);

        switch(msg.action){
            case 'client-hello':
                socket.write(JSON.stringify({
                    "sender-ip": socket.remoteAddress+':'+socket.remotePort,
                    "action": "server-hello",
                    "msg": "Hello"}));
                break;
        }
    });
}).listen(PORT, HOST, () => {
    debug(`Server listening on ${HOST}:${PORT}`);
});