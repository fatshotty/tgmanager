const ShortUniqueID = require('short-unique-id');
const {Config} = require('../config');
const {UPLOAD_CHUNK} = require('../constants');
const Mime = require('mime-types');
const Logger = require('../logger');
const Stream = require('stream');
const EventEmitter = require('events');

const Log = new Logger('Uploader');

const UUID = new ShortUniqueID({dictionary: 'number', length: 19});

const CHUNK = UPLOAD_CHUNK;

class Uploader extends EventEmitter {
  aborted = false;

  client = null;
  channelId = null;
  totalFileParts = [];
  filename = '';
  currentFilePartIndex = -1;
  tgChannel = null;
  totalFileBytes = Buffer.alloc(0);
  sourceStream = null;


  constructor(client, channelId, filename) {
    super();
    this.client = client;
    this.filename = filename;
    this.channelId = channelId || Config.telegram.upload.channel;

  }

  stop() {
    Log.warn('uploader has been stopped');
    this.aborted = true;
    this.sourceStream.removeAllListeners('data');
    this.sourceStream.removeAllListeners('end');
    this.sourceStream.destroy();
    this.emit('stopped');
  }

  async prepare() {
    const channel = await this.client.getChannel( this.channelId );
    this.tgChannel = {
      id: channel.id,
      hash: channel.access_hash
    }
  }

  async execute(source) {

    let buf = null;

    this.newPortionFile();

    this.sourceStream = new Stream.PassThrough();

    source.pause();

    this.sourceStream.on('data', async (chunk) => {
      if (buf) {
        buf = Buffer.concat([buf, chunk]);
      } else {
        buf = chunk;
      }
  
      const uploadChunk = Uint8Array.prototype.slice.call(buf, 0, CHUNK);

      if ( uploadChunk.length < CHUNK ) {
        // wait for next chunk, or it could be complted (see 'end' event handler)
        return;
      }

      // Log.debug('buffer on data', chunk.length, 'total', uploadChunk.length);
      
      buf = Uint8Array.prototype.slice.call(buf, CHUNK);

      this.sourceStream.pause();
      await this.uploadChunk(uploadChunk);
      
      this.sourceStream.resume();

    });

    this.sourceStream.on('end', async () => {
      const currentPortion = this.getCurrentPortion();

      Log.debug('stream is ended:', buf.length, 'part:', currentPortion.currentPart + 1);

      const uploadChunk = Uint8Array.prototype.slice.call(buf, 0, CHUNK);
      if ( uploadChunk.length ) {
        Log.info('upload last chunk and then save into channel');
        await this.uploadChunk(uploadChunk, true);
      } else {
        await this.sendToChannel(currentPortion);
      }

      if ( !this.aborted ) {
        this.emit('completeUpload', this.totalFileParts, this.channelId);
      }

    });

    source.pipe(this.sourceStream);
    // force resume stream
    source.resume();
  }

  getCurrentPortion() {
    return this.totalFileParts[this.currentFilePartIndex];
  }

  newPortionFile() {
    this.currentFilePartIndex = this.totalFileParts.push({
      index: this.totalFileParts.length,
      fileId: Number(UUID.randomUUID()),
      currentPart: -1,
      mime: Mime.lookup(this.filename) || 'application/octet-stream',
      filename: this.filename,
      msgid: null,
      size: 0,
      content: null
    }) - 1;
    return this.totalFileParts[ this.currentFilePartIndex ];
  }

  getTotalFileSize() {
    return this.totalFileParts.reduce( (acc, value) => acc += value.size, 0);
  }


  async uploadChunk(buffer, lastChunk) {

    const {maxUploadParts} = this.client.Login;
    let currentPortion = this.getCurrentPortion();

    if ( !currentPortion ) {
      currentPortion = this.newPortionFile();
    }

    currentPortion.size += buffer.byteLength;

    let sendToChannel = false;
    let shouldUpload = true;

    if (this.getTotalFileSize() > Config.telegram.upload.min_size ) {

      if ( this.totalFileBytes && this.totalFileBytes.length ) {
        // force pause stream
        Log.debug('Force upload in-memory buffer because it exceeds upload.min_size:', this.totalFileBytes.length);
        this.sourceStream.pause();
        while( this.totalFileBytes.length ) {
          const buf = Uint8Array.prototype.slice.call(this.totalFileBytes, 0, CHUNK);
          this.totalFileBytes = Uint8Array.prototype.slice.call(this.totalFileBytes, CHUNK);
          
          currentPortion.currentPart += 1;
          
          const res = await this.client.sendFileParts(
            currentPortion.fileId,
            currentPortion.currentPart,
            -1,
            buf,
          );
          Log.debug('upload on telegram OK, part:', currentPortion.currentPart, 'total bytes:', (currentPortion.currentPart + 1) * CHUNK);
        }
        this.totalFileBytes = null;

      }

    } else {
      this.totalFileBytes = Buffer.concat([this.totalFileBytes, buffer]);
      shouldUpload = false;
      Log.debug('Buffer in-memory because of upload.min_size:', this.totalFileBytes.length);
    }

    if (shouldUpload) {
      currentPortion.currentPart += 1;
      sendToChannel = currentPortion.currentPart == maxUploadParts;

      if ( sendToChannel ) {
        // handle next portion of file
        this.newPortionFile();
      }

      if ( !this.aborted ) {
        const res = await this.client.sendFileParts(
          currentPortion.fileId,
          currentPortion.currentPart,
          (sendToChannel || lastChunk ? Math.ceil(currentPortion.size / CHUNK) : -1),
          buffer,
        );
        Log.debug('upload on telegram OK, part:', currentPortion.currentPart, 'total bytes:', (currentPortion.currentPart + 1) * CHUNK);
      }
    }

    if ( sendToChannel || lastChunk ) {
      await this.sendToChannel(currentPortion);
    }
    
  }


  async sendToChannel(portion) {
    let {filename} = portion; 

    if ( this.totalFileParts.length > 1 ) {
      filename = `${filename}.${ ('000' + String(portion.index + 1)).slice( -3 ) }`;
    }

    if ( this.aborted )  {
      Log.warn(`cannot finish upload because of aborted`);
      return;
    }

    if ( this.totalFileBytes !== null ) {
      // file is buffered into memory and needs to be directly inserted into db
      portion.content = this.totalFileBytes;
    } else {

      const res = await this.client.moveFileToChat(
        this.tgChannel ? {
          id: this.tgChannel.id,
          hash: this.tgChannel.hash
        } : null,
        {
          fileId: portion.fileId,
          parts: Math.ceil(portion.size / CHUNK),
          filename: filename,
          mime: portion.mime
        }
      );

      const {message} = res.updates.find( (u) => !!u.message );
      portion.msgid = message.id;
      portion.fileId = message.media.document.id;
      portion.filename = message.media.document.attributes.find( i => i['_'] == 'documentAttributeFilename').file_name
      // portion.hash = message.media.document.access_hah;
    }

    this.emit('portionUploaded', portion);

  }

}


module.exports = Uploader;