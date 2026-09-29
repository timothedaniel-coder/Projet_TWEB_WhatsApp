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
    debug('Connected');
    client.write(JSON.stringify({
        "sender": argv.name,
        "action": "client-hello"
    }));
});

client.on('data', function(data) {
    debug('Received: ' + data);
    process.stdout.write('>');
});

rl.prompt();

rl.on('line', (line) => {
    switch(line.trim()) {
        case 'hello':
            client.write(JSON.stringify({"action":"client-hello"}));
            break; 
    }
    rl.prompt();
});