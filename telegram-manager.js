const TelegramClients = require('./services/clients');
const {Config} = require('./config');
const DB = require('./services/databases');
const Logger = require('./logger');
const Path = require('path');
const {ROOT_ID} = require('./constants');

const STRM = require('./strm');

const Bot = require('./services/telegram-bot');

const Log = new Logger('APP');


Logger.log(`----- STARTING UP [${process.pid}]------`);

// Initializing app
require('./initialize');

async function start() {

  Log.log('Starting application');
  await DB.initDatabase();

  for ( const user of Config.telegram.users){
    await TelegramClients.addClient( user, Config.telegram.bot_token );
  }

  if ( Config.http ) {
    require('./server-express');
  }
  if ( Config.webdav ) {
    require('./webdav');
  }
  if ( Config.strm ) {
    STRM.init( ROOT_ID, Path.resolve(Config.strm.folder) );
  }

  if ( Config.telegram.bot_token ) {
    // Bot.start();
  }

}


// process.on('uncaughtException', (err, origin) => {
//   Logger.log(
//     `Caught exception: ${err}\n` +
//     `Exception origin: ${origin}\n`,
//      err.stack
//   );
// });

function handle(signal) {
  Logger.log(`---- Exit: ${signal} ----`);
  DB.close();
  Bot.close();
  process.exit(0);
}

process.on('SIGINT', handle);
process.on('SIGTERM', handle);

start();
