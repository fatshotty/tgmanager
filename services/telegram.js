const Path = require('path');
const MTProto = require('@mtproto/core');
const {sleep} = require('@mtproto/core/src/utils/common');
const {Config} = require('../config');
const {getTelegramData, setTelegramData} = require('./databases');
const Logger = require('../logger');
const ShortUniqueID = require('short-unique-id');


const UUID = new ShortUniqueID({dictionary: 'number', length: 19});

const Log = new Logger('Telegram');

class TelgramStorage {
  prefix = null;

  constructor(prefix) {
    this.prefix = prefix;
  }
  async get(key) {
    const data = await getTelegramData( `${this.prefix}-${key}` );
    return data && data.value;
  }

  async set(key, value) {
    return await setTelegramData({key: `${this.prefix}-${key}`, value});
  }

}


class TelegramApi {
  __options__ = {};
  userid = null;

  constructor(userid, api_id, api_hash, storage) {
    this.mtproto = new MTProto({
      api_id,
      api_hash,
      storageOptions: {
        path: Path.resolve( Path.join(Config.data, `/telegram-session-${userid}.json`) ),
        instance: Config.telegram.database ? new TelgramStorage(userid) : undefined
      }
    });
    this._login = new TelegramLogin(this);
    this.userid = userid;
  }

  get Login() {
    return this._login;
  }

  async loginAsBot(token) {
    return this.apiCall('auth.importBotAuthorization', {
      api_id: this.mtproto.api_id,
      api_hash: this.mtproto.api_hash,
      bot_auth_token: token
    })
  }

  async apiCall(method, params, options = {}) {
    try {
      Object.assign(this.__options__, options)
      const result = await this.mtproto.call(method, params, this.__options__);
      return result;
    } catch (error) {
      Log.warn(`${method} error:`, error);

      const { error_code, error_message } = error;

      if (error_code === 420) {
        const seconds = Number(error_message.split('FLOOD_WAIT_')[1]);
        const ms = seconds * 1000;

        Log.warn('FLOOD_WAIT', ms, 'ms');
        await sleep(ms);

        Log.info('FLOOD_WAIT completed');
        return this.apiCall(method, params, options);
      }

      if (error_code === 303) {
        const [type, dcIdAsString] = error_message.split('_MIGRATE_');

        const dcId = Number(dcIdAsString);
        Log.warn('need migration DC to', dcId);

        // If auth.sendCode call on incorrect DC need change default DC, because
        // call auth.signIn on incorrect DC return PHONE_CODE_EXPIRED error
        if (type === 'PHONE') {
          await this.mtproto.setDefaultDc(dcId);
        } else {
          Object.assign(options, { dcId });
        }

        return this.apiCall(method, params, options);
      }

      return Promise.reject(error);
    }
  }

  async getChannel(id) {
    const channels = await this.apiCall('channels.getChannels', {
      id: [{
        _: "inputChannel",
        channel_id: id
    }]
    });
    return channels.chats[0];
  }


  async getMessage({id, hash}, msgId) {
    const messages = await this.apiCall('channels.getMessages', {
      channel: {
        _: "inputChannel",
        channel_id: id,
        access_hash: hash
      },
      id: [{
        _: "inputMessageID",
        id: msgId
      }]
    });
    return messages.messages[0];
  }


  async getFile({id, access_hash, file_reference, dc}, offset, limit) {
    return await this.apiCall('upload.getFile', {
      location: {
        _: 'inputDocumentFileLocation',
        id,
        access_hash,
        file_reference
      },
      offset,
      limit,
      precise: false
    }, {dcId: dc});
  }

  async sendFileParts(fileId, part, parts, chunk) {
    return await this.apiCall(`upload.saveBigFilePart`, {
      file_id: Number(fileId),
      file_part: part,
      file_total_parts: parts,
      bytes: chunk
    });
  }

  async moveFileToChat(channel, {fileId, parts, filename, mime}) {
    return await this.apiCall(`messages.sendMedia`, {
      peer: channel ? {
        '_': 'inputPeerChannel',
        channel_id: channel.id,
        access_hash: channel.hash
      } : { '_': 'inputPeerSelf' },
      random_id: UUID.randomUUID(),
      media: {
        '_': 'inputMediaUploadedDocument',
        file: {
          '_': 'inputFileBig',
          id: Number(fileId),
          parts: parts,
          name: filename,
        },
        mime_type: mime,
        attributes: [{
          '_': 'documentAttributeFilename',
          file_name: filename
        }]
      }
    });
  }


  async forwardMessage(msgId, chFrom, chTo) {
    return await this.apiCall('messages.forwardMessages', {
      silent: true,
      drop_author: true,
      from_peer: {
        '_': 'inputPeerChannel',
        channel_id: chFrom.id,
        access_hash: chFrom.hash
      },
      to_peer: {
        '_': 'inputPeerChannel',
        channel_id: chTo.id,
        access_hash: chTo.hash
      },
      id: [msgId],
      random_id: [UUID.randomUUID()]
    });
  }

  async deleteMessage(channel, msgId) {
    return await this.apiCall('channels.deleteMessages', {
      channel: {
        '_': 'inputPeerChannel',
        channel_id: channel.id,
        access_hash: channel.hash
      },
      id: [msgId]
    });
  }


}


class TelegramLogin {

  infos = [];
  premium = false;
  username = '';

  maxUploadParts = 0;

  constructor(api) {
    this.api = api;
  }

  async getCurrentUser() {
    try {
      const user = await this.api.apiCall('users.getFullUser', {
        id: {
          _: 'inputUserSelf',
        },
      });

      this.premium = user.users[0].premium;
      this.username = user.users[0].username;
  
      return user;

    } catch (error) {
      return Promise.reject(error);
    }
  }
  
  async getUserConfig() {
    try {
      const info = await this.api.apiCall('help.getAppConfig', {
        hash: 0
      });
  
      this.infos = info.config.value;
      this.maxUploadParts = this.getConfig( this.premium ? 'upload_max_fileparts_premium' : 'upload_max_fileparts_default' );

    } catch (error) {
      return Promise.reject(error);
    }
  }

  getConfig(key) {
    const res = this.infos.find( i => i.key == key );
    return res ? res.value.value : null;
  }

  async sendCode(phone) {
    return this.api.apiCall('auth.sendCode', {
      phone_number: phone,
      settings: {
        _: 'codeSettings',
      },
    });
  }


  async signIn({ code, phone, phone_code_hash }) {
    return this.api.apiCall('auth.signIn', {
      phone_code: code,
      phone_number: phone,
      phone_code_hash: phone_code_hash,
    });
  }


  async getPassword() {
    return this.api.apiCall('account.getPassword');
  }

  async checkPassword({ srp_id, A, M1 }) {
    return this.api.apiCall('auth.checkPassword', {
      password: {
        _: 'inputCheckPasswordSRP',
        srp_id,
        A,
        M1,
      },
    });
  }

}

module.exports = {TelgramStorage, TelegramApi};