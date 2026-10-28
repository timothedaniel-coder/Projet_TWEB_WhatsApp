const chalk = require('chalk');
const util = require('util');
const net = require('net');
const readline = require('readline');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
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
    client.write(createMessage(ACTIONS.HELLO, argv.name));
    rl.prompt();
});

let buffer = '';

client.on('data', function(data) {
    buffer += data.toString();
    
    let boundary = buffer.indexOf('\n');
    while (boundary !== -1) {
        const messageStr = buffer.substring(0, boundary).trim();
        buffer = buffer.substring(boundary + 1);
        
        if (messageStr) {
            try {
                const parsedData = JSON.parse(messageStr);
                
                process.stdout.clearLine();
                process.stdout.cursorTo(0);
                
                switch (parsedData.action) {
                    case ACTIONS.SRV_JOINED:
                        console.log(chalk.yellow(`👋 ${parsedData.user} a rejoint le serveur.`));
                        break;
                    case ACTIONS.SRV_LEFT:
                        console.log(chalk.yellow(`🚪 ${parsedData.user} a quitté le serveur.`));
                        break;
                    case ACTIONS.SRV_SEND_ACK:
                        console.log(chalk.gray(`✓ Message bien envoyé à ${parsedData.dest}.`));
                        break;
                    case ACTIONS.SRV_BROADCAST_ACK:
                        console.log(chalk.gray(`✓ Message diffusé à ${parsedData.count} personne(s).`));
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
                    case 'server-cgroupe':
                        console.log(chalk.green(`✓ ${parsedData.msg}`));
                        break;
                    case 'server-groups':
                        const list = parsedData.groups && parsedData.groups.length > 0 ? parsedData.groups.join(', ') : 'Aucun groupe';
                        console.log(chalk.cyan(`Groupes existants : ${list}`));
                        break;
                    default:
                        if (parsedData.msg) console.log(chalk.cyan(parsedData.msg));
                }
            } catch (e) {
                debug('Erreur JSON côté client : ' + e.message);
            }
        }
        boundary = buffer.indexOf('\n');
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
            client.write(createMessage(ACTIONS.SEND, argv.name, { msg: message, dest: dest }));
        }
    }
    else if (text.startsWith(COMMANDS.BROADCAST)) {
        const message = text.substring(COMMANDS.BROADCAST.length);
        client.write(createMessage(ACTIONS.BROADCAST, argv.name, { msg: message }));
    }
    else if (text === COMMANDS.LIST) {
        client.write(createMessage(ACTIONS.LIST, argv.name));
    }
    else if (text.startsWith(COMMANDS.CREATE_GROUP)) {
        const groupName = text.substring(COMMANDS.CREATE_GROUP.length).trim();
        if (groupName) {
            client.write(createMessage(ACTIONS.CREATE_GROUP, argv.name, { group: groupName }));
        } else {
            console.log(chalk.red('Erreur : veuillez spécifier un nom de groupe (ex: cg;wob)'));
        }
    }
    else if (text === COMMANDS.GROUPS) {
        client.write(createMessage(ACTIONS.LIST_GROUPS, argv.name));
    }
    else if (text === COMMANDS.QUIT) {
        client.write(createMessage(ACTIONS.QUIT, argv.name));
        client.end();
        process.exit(0);
    }
    rl.prompt();
});