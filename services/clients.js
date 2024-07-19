const { TelegramApi, TelegramStorage } = require('./telegram');
const {loginFlow} = require('../utils');
const Logger = require('../logger');

const Log = new Logger('Clients');


class TelegramClients {

  clients = [];
  clientIndex = 0;

  constructor() {
    this.clients = [];
  }

  get Client() {
    const c = this.clients[ this.clientIndex ];
    Log.info('using client', c.Login.username);
    return this.clients[ this.clientIndex ];
  }


  nextClient() {
    this.clientIndex++;
    if (this.clientIndex > this.clients.length - 1) {
      this.clientIndex = 0;
    }
    Log.debug('switch client:', this.clientIndex);
  }


  async addClient(userConfig, botToken) {

    const tg = new TelegramApi(userConfig.id, userConfig.api_id, userConfig.api_hash);

    Log.info('Load client for user:', userConfig.id);

    try {

      const bot = await tg.loginAsBot(botToken);

      const user = await tg.Login.getCurrentUser();
      // await tg.Login.getUserConfig();

      Log.info('Login OK for user:', user.users[0].username, `${tg.Login.premium ? 'is premium' : 'is NOT premium'}`, 'and can upload', tg.Login.maxUploadParts, 'parts');

    } catch (e) {
      if ( e.error_code == 401 ) {
        Log.warn('user need to be logged-in');

        const user = await loginFlow(tg);
        Log.info('Login OK for user:', user.user.username);

      } else {

        return Promise.reject(e);
      }
    }

    this.clients.push(tg);
  }

}


module.exports = new TelegramClients;