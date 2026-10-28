const util = require('util');
var net = require('net');
const readline = require('readline');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const debug = util.debuglog('client');
const argv = yargs(hideBin(process.argv)).argv;
var client = new net.Socket();
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
});

client.connect(PORT, HOST, function() {
    console.log('Connecté au serveur');
        client.write(JSON.stringify({
        "sender": argv.name,
        "action": "client-connect" 
    }));
    
    rl.prompt();
});

client.on('data', function(data) {
    debug('Traces techniques reçues : ' + data);
    const parsedData = JSON.parse(data);
    if (parsedData.msg) {
        console.log(parsedData.msg); 
    }
    rl.prompt();
});

rl.on('line', (line) => {
    const text = line.trim();
    
    if (text === 'hello') {
        client.write(JSON.stringify({
            "sender": argv.name,
            "action": "client-hello"
        }));
    } 
    else if (text.startsWith('s;')) {
        const parts = text.split(';');         
        if (parts.length >= 3) {
            const dest = parts[1];
            const message = parts.slice(2).join(';');
            
            client.write(JSON.stringify({
                "sender": argv.name,
                "dest": dest,
                "msg": message,
                "action": "client-send"
            }));
        }
    }
    else if (text.startsWith('b;')) {
        const message = text.substring(2); // Récupère tout ce qui suit "b;"
        client.write(JSON.stringify({
            "sender": argv.name,
            "msg": message,
            "action": "client-broadcast"
        }));
    }
    else if (text === 'ls;') {
        client.write(JSON.stringify({
            "sender": argv.name,
            "action": "client-list-clients"
        }));
    }
    rl.prompt();
});