const chalk = require('chalk');
const util = require('util');
const net = require('net');
const readline = require('readline');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
// Importation du module commun
const { ACTIONS, createMessage, COMMANDS } = require('../common/protocol.js');

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

client.connect(PORT, HOST, function() {
    console.log(chalk.green.bold('Connecté au serveur'));
    client.write(createMessage(ACTIONS.CONNECT, argv.name));
    rl.prompt();
});

client.on('data', function(data) {
    debug('Traces techniques reçues : ' + data);
    const parsedData = JSON.parse(data);
    if (parsedData.msg) {
        // Efface la ligne actuelle pour éviter que le message s'écrive par-dessus le prompt
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        
        if (parsedData.sender === "serveur") {
            console.log(chalk.yellow(parsedData.msg));
        } else {
            console.log(chalk.cyan(parsedData.msg));
        }
    }
    rl.prompt();
});

rl.on('line', (line) => {
    const text = line.trim();
    
    if (text === COMMANDS.HELLO) {
        client.write(createMessage(ACTIONS.HELLO, argv.name));
    } 
    else if (text.startsWith(COMMANDS.SEND)) {
        const parts = text.split(';');         
        if (parts.length >= 3) {
            const dest = parts[1];
            const message = parts.slice(2).join(';');
            client.write(createMessage(ACTIONS.SEND, argv.name, message, dest));
        }
    }
    else if (text.startsWith(COMMANDS.BROADCAST)) {
        const message = text.substring(COMMANDS.BROADCAST.length);
        client.write(createMessage(ACTIONS.BROADCAST, argv.name, message));
    }
    else if (text === COMMANDS.LIST) {
        client.write(createMessage(ACTIONS.LIST, argv.name));
    }
    else if (text === COMMANDS.QUIT) {
        client.write(createMessage(ACTIONS.QUIT, argv.name));
        client.end();
        process.exit(0);
    }
    rl.prompt();
});