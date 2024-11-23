// This file uses the alexa-remote library (https://github.com/Apollon77/alexa-remote)
// distributed under the MIT License.

'use strict';

const Alexa = require('alexa-remote2');
const EventEmitter = require('events');
const EchoDevice = require('./EchoDevice');
const Os = require('os');

const deviceFamily = [
  "KNIGHT",
  "ECHO"
];


class EchoConnect extends EventEmitter {
  constructor(showLog = false) {
    super();

    this.alexa = new Alexa();
    this.cookieExist = false;
    this.devices = {};
    this.arrayDevices = [];
    this.loginUrl = null;
    this.newLogIn = false;
    this.showLog = showLog;
    this.config = '';
    this.registerAlexaListeners();
  }

  log(...args) {
    if (this.showLog) {
      const timestamp = new Date().toISOString();
      const message = args.join(' ');
      console.log(`[DEBUG] ${timestamp} - ${message}`);
    }
  }

  registerAlexaListeners() {
    /* 
      Register alexa-remote library listeners 
      */
    // Listener to manage alexa cookie
    this.alexa.on('cookie', (cookie, csrf, macDms) => {
      // This event is triggered when a cookie is generated OR refreshed.
      // Store these values for subsequent starts
      //
      // cookie to provide in options.cookie on next start
      // csrf belongs to cookie and both needed, but is normally extracted from cookie again on start
      // macDms needed for push connections. Provide in options.macDms on next start
      // Get alexa.cookieData and store too and provide the content in options.formerRegistrationData on next start to allow cookie refreshs
      //   You can also just store alexa.cookieData and provide this object as options.cookie, then options.formerRegistrationData is handled internally too
      this.log('cookie generato o rifreshato')

      this.emit('cookieGenerated', this.newLogIn, this.alexa.cookieData);
      this.newLogIn = false;
    });

    // Listener when initPushMessage is called
    this.alexa.on('ws-connect', () => {
      setTimeout(() => {
        this.log('Push message connected')

        this.emit('pushConnected');
      }, 1);
    });

    // Listener when initPushMessage is disconnected
    this.alexa.on('ws-disconnect', (willReconnect, reason) => {
      this.log('Push message disconnected')

      this.emit('pushDisconnected', willReconnect, reason);
    });

    // Listener to manage push notification from Echo
    this.alexa.on('command', (command) => {
      const echoSerial = command.payload.dopplerId.deviceSerialNumber;

      if (this.echoExist(echoSerial)) {
        // Manage the various types of commands
        switch (command.command) {
          // case 'PUSH_AUDIO_PLAYER_STATE':
          //   this.log('Audio player state change:', command.payload);
          //   break;
          case 'PUSH_VOLUME_CHANGE':
            const newVolume = command.payload.volumeSetting;
            const updatedSuccessfully = this.updateVolumeArray(echoSerial, newVolume);

            if (updatedSuccessfully) {
              this.log('Volume updated successfully');

              this.emit('volumeChanged', echoSerial, newVolume);

            } else {
              this.error('Volume update failed!');
            }
            break;
          // case 'PUSH_DOPPLER_CONNECTION_CHANGE':
          //   this.log('Changing device connection:', command.payload);
          //   break;
          // case 'PUSH_BLUETOOTH_STATE_CHANGE':
          //   this.log('Bluetooth state change:', command.payload);
          //   break;
          // case 'PUSH_MEDIA_QUEUE_CHANGE':
          //   this.log('Change in media queue:', command.payload);
          //   break;
          // default:
          //   this.log('Unmanaged command type:', command.command);
        }
      }
    });
  }

  getAmazonUrl() {
    function generateDeviceId() {
      const buf = Buffer.alloc(16); // 16 byte random
      const bufHex = Crypto.randomFillSync(buf).toString('hex').toUpperCase(); // converti in hex = 32x 0-9A-F
      return Buffer.from(bufHex).toString('hex') + '23413249564c5635564d32573831'; // converti in hex = 64 caratteri che sono hex dell'id hex
    }

    function generateCodeChallenge() {
      const codeVerifier = Crypto.randomBytes(32).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      const codeChallenge = Crypto.createHash('sha256')
        .update(codeVerifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      return { codeVerifier, codeChallenge };
    }

    if (!this.config.baseAmazonPageHandle && this.config.baseAmazonPageHandle !== '') {
      const amazonDomain = this.config.baseAmazonPage.substr(this.config.baseAmazonPage.lastIndexOf('.') + 1);
      if (amazonDomain === 'jp') {
        this.config.baseAmazonPageHandle = `_${amazonDomain}`;
      }
      else if (amazonDomain !== 'com') {
        //this.config.baseAmazonPageHandle = '_' + amazonDomain;
        this.config.baseAmazonPageHandle = '';
      }
      else {
        this.config.baseAmazonPageHandle = '';
      }
    }

    const deviceId = this.config.formerRegistrationData?.deviceId || generateDeviceId();
    const { codeVerifier, codeChallenge } = generateCodeChallenge();

    const loginUrl = 'https://www.' + this.config.baseAmazonPage + '/ap/signin?'
      + 'openid.return_to=https%3A%2F%2Fwww.' + this.config.baseAmazonPage + '%2Fap%2Fmaplanding&'
      + 'openid.assoc_handle=amzn_dp_project_dee_ios' + this.config.baseAmazonPageHandle + '&'
      + 'openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&'
      + 'pageId=amzn_dp_project_dee_ios' + this.config.baseAmazonPageHandle + '&'
      + 'accountStatusPolicy=P1&'
      + 'openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&'
      + 'openid.mode=checkid_setup&'
      + 'openid.ns.oa2=http%3A%2F%2Fwww.' + this.config.baseAmazonPage + '%2Fap%2Fext%2Foauth%2F2&'
      + 'openid.oa2.client_id=device%3A' + deviceId + '&'
      + 'openid.ns.pape=http%3A%2F%2Fspecs.openid.net%2Fextensions%2Fpape%2F1.0&'
      + 'openid.oa2.response_type=code&'
      + 'openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&'
      + 'openid.pape.max_auth_age=0&'
      + 'openid.oa2.scope=device_auth_access&'
      + 'openid.oa2.code_challenge_method=S256&'
      + 'openid.oa2.code_challenge=' + codeChallenge + '&'
      + 'language=' + this.config.amazonPageProxyLanguage;

    return {
      loginUrl,
      deviceId,
      codeVerifier,
      codeChallenge
    };
  }

  getIPAddress() {
    const interfaces = Os.networkInterfaces();
    for (const devName in interfaces) {
      const iface = interfaces[devName];
      for (let i = 0; i < iface.length; i++) {
        const alias = iface[i];
        if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
          return alias.address;
        }
      }
    }
    return '0.0.0.0';
  }

  // Saves all the extracted devices in a JSON file
  async saveAllDevices() {
    try {
      await AsyncFs.writeFile('alexa-devices.json', JSON.stringify(this.devices, null, 2));
      this.log('Dispositivi salvati con successo!');
    } catch (err) {
      console.error('Errore nel salvataggio dei dispositivi:', err);
    }
  }

  // Make Echo speak
  async speakEcho(serial, text) {
    try {
      await this.alexa.sendSequenceCommand(serial, 'speak', text);
    } catch (err) {
      console.error('Errore nell\'invio del comando di parlato:', err);
    }
  }

  // Set Echo volume
  async setVolumeDevice(serial, volume) {
    try {
      await this.alexa.sendSequenceCommand(serial, 'volume', volume);
      this.updateVolumeArray(serial, volume);
    } catch (err) {
      console.error('Error sending volume command:', err);
    }
  }

  // Updates the array with the volume of an EchoDevice object that has a given serial number
  updateVolumeArray(serial, volume) {
    const index = this.arrayDevices.findIndex(p => p.getSerial() === serial);
    if (index !== -1) {
      this.arrayDevices[index].setVolume(volume);
      this.log(`Array - Updated volume for device ${this.arrayDevices[index].name}: ${volume}`);
      return true;
    } else {
      this.log(`Array - No device found for the serial ${serial}`);
      return false;
    }
  }

  // Get Echo volume
  getVolumeDevice(serial) {
    return new Promise((resolve, reject) => {
      this.alexa.getAllDeviceVolumes((err, state) => {
        if (err) {
          reject(new Error(`Error recovering device volume: ${err.message}`));
          return;
        }

        const echo = state.volumes.filter(volume => volume.dsn === serial);

        if (echo.length > 0) {
          this.updateVolumeArray(serial, echo[0].speakerVolume)
          resolve(echo[0].speakerVolume);
        } else {
          reject(new Error(`Serial number ${serial} not found`));
        }
      });
    });
  }

  // Initializes receiving push updates from devices
  async initPushMessage() {
    this.log('initPushMessage called!');
    return new Promise((resolve, reject) => {
      try {
        this.alexa.initPushConnection((err) => {
          if (err) {
            this.log('initPushMessage promise - Errore nell\'inizializzazione degli aggiornamenti push');
            reject(err);
          } else {
            this.log('initPushMessage Inizializzazione aggiornamenti push completata');
            resolve();
          }
        });
      } catch (error) {
        this.log('initPushMessage catch - Errore nell\'inizializzazione degli aggiornamenti push');
        reject(error);
      }
    });
  }

  // Check if we receive device status updates
  isPushConnected() {
    return this.alexa.isPushConnected() === true || false;
  }

  // Stops receiving update push messages from devices
  stopPushMessage() {
    //if (this.alexa.alexahttp2Push && this.alexa.alexahttp2Push.isConnected()) {
    this.alexa.stop();
    this.alexa.alexahttp2Push = null;

    this.log('Push message from Echo disconnected manually');

    this.emit('pushDisconnected', false, 'Disconnected by the user');

    // } else {
    //   console.error('Push message not conected');
    // }
  }

  // Check if the connection to Alexa is ready
  async isAuthenticated() {
    try {
      const authenticated = await new Promise((resolve, reject) => {
        this.alexa.checkAuthentication((authenticated, err) => {
          if (err) {
            console.error('Error while verifying authentication:', err);
            reject(err);
          } else {
            if (authenticated) {
              this.log('Authentication with Alexa is valid');
            } else {
              this.log('Alexa authentication is invalid or has expired');
            }
            resolve(authenticated);
          }
        });
      });
      return authenticated;
    } catch (error) {
      console.error('An error occurred during authentication:', error);
      throw error;
    }
  }

  // Returns an object of the EchoDevice class starting from the serial number
  findEchoBySerial(serial) {
    return this.arrayDevices.find(echoDevice => echoDevice.getSerial() === serial);
  }

  // Check if an object of class EchoDevice with given serial number exists in the array
  echoExist(serial) {
    return this.arrayDevices.some(echoDevice => echoDevice.getSerial() === serial);
  }

  // Creates an array of EchoDevice with the information in the Json this.device
  filterAndFormatDevices() {
    const filteredDevices = this.devices.devices.filter(device =>
      deviceFamily.includes(device.deviceFamily)
    );

    //this.log('filterAndFormatDevices: ', JSON.stringify(filteredDevices, null, 2));

    return filteredDevices.map(device => {
      const myDevice = new EchoDevice();
      myDevice.name = device.accountName;
      myDevice.family = device.deviceFamily;
      myDevice.type = device.deviceType;
      myDevice.serial = device.serialNumber;
      return myDevice;
    });
  }

  // Initialize Alexa creating the connection
  async initAlexa({
    cookieData,
    amazonPage = 'amazon.com',
    forceToken = false,
    closeWindowMessage = 'You can now close this window.',
    closeWindowImageUrl = '',
    retryCount = 0
  } = {}) {

    this.log('initAlexa called!');

    return new Promise((resolve, reject) => {
      this.config = this.getAlexaConfig(
        cookieData,
        amazonPage,
        forceToken,
        closeWindowMessage,
        closeWindowImageUrl
      );

      //this.log('confing string: ', JSON.stringify(this.config));

      this.alexa.init(this.config, (err) => {

        // Cookie NOT available or EXPIRED/NOT WORKS
        if (err) {
          // Cookie exists but doesn't work so force a new Init with refresh of the token checkig if the method goes in loop
          if (this.cookieExist) {
            this.log('retryCount: ', retryCount);

            if (retryCount >= 2) {
              this.log('Max number of attempts reached. Unable to initialize Alexa.');
              reject(new Error('Unable to initialize Alexa after multiple attempts'));
              return;
            }

            this.initAlexa({
              cookieData: '',
              amazonPage: amazonPage,
              froceToken: true,
              closeWindowMessage: closeWindowMessage,
              closeWindowImageUrl: closeWindowImageUrl,
              retryCount: retryCount + 1
            })
              .then(resolve)
              .catch(reject);

            // Cookie doesn't exist
          } else {
            this.newLogIn = true;
            this.loginUrl = `http://${this.config.proxyOwnIp}:${this.config.proxyPort}`;

            reject(`Token not found. Please connect to the following link: http://${this.config.proxyOwnIp}:${this.config.proxyPort}`)
          }

          // Cookie AVAILABLE
        } else {
          this.log('Alexa initialized successfully');

          // Fill the Json this.devices
          this.alexa.getDevices((err, devices) => {

            if (err) {
              console.error('Error recovering devices:', err);

              reject(err);

            } else {
              this.log('Devices recovered');

              this.devices = devices;
              //this.saveAllDevices();

              // Fill the array with EchoDevice objects created starting from the data contained in the Json
              this.arrayDevices = this.filterAndFormatDevices();

              // Call the alexaConnecte event
              this.emit('alexaConnected', this.arrayDevices);

              resolve();
            }
          });
        }
      });
    });
  }

  generateCloseWindowHtmlContent(message, imageUrl) {
    const imageHtml = imageUrl
      ? `
    <div class="image-container">
        <img src="${imageUrl}" alt="Immagine personalizzata">
    </div>`
      : '';

    return `
      <!DOCTYPE html>
      <html lang="it">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Messaggio personalizzato</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f0f0f0;
                }
                .image-container {
                    margin-bottom: 20px;
                }
                img {
                    max-width: 100%;
                    height: auto;
                }
                .message {
                    font-size: 24px;
                    color: #333;
                    text-align: center;
                }
            </style>
        </head>
        <body>
            ${imageHtml}
            <div class="message">
                ${message}
            </div>
        </body>
      </html>
    `;
  }


  isCookieEmptyOrNull(cookieData) {
    // Verifica se la stringa è null o undefined
    if (cookieData === null || cookieData === undefined || cookieData === "null") {
      return true;
    }

    // Verifica se la stringa è vuota o contiene solo spazi bianchi
    if (typeof cookieData === "string" && cookieData.trim().length === 0) {
      return true;
    }

    try {
      // Prova a parsificare la stringa JSON
      const jsonObject = JSON.parse(cookieData);

      // Verifica se l'oggetto JSON è vuoto
      return Object.keys(jsonObject).length === 0;
    } catch (error) {
      // Se il parsing fallisce, la stringa non è un JSON valido
      return false;
    }
  }

  // Returns the configuration string for connecting to Alexa servers
  getAlexaConfig(cookieData, page, forceRefresh, message, imageUrl) {
    this.log('getAlexaConfig called');

    this.cookieExist = !this.isCookieEmptyOrNull(cookieData);

    if (!this.cookieExist || forceRefresh) {
      this.log('Cookie NON trovato, è necessario autenticarsi');
      return {
        //logger: console.log,
        proxyOnly: true,
        proxyOwnIp: this.getIPAddress(),
        proxyPort: 3000,
        amazonPageProxyLanguage: 'en_EN',
        amazonPage: page,
        baseAmazonPage: page,
        acceptLanguage: 'en_EN',
        proxyCloseWindowHTML: this.generateCloseWindowHtmlContent(message, imageUrl)
      };
    } else {
      this.log('Cookie trovato! Non serve autenticarsi');
      //const cookieData = JSON.parse(Fs.readFileSync(this.cookiePath, 'utf8'));
      return {
        cookie: `${cookieData.loginCookie}; csrf=${cookieData.csrf}`,
        //logger: console.log,
        amazonPage: page,
        baseAmazonPage: page,
        acceptLanguage: 'en_EN',
        formerRegistrationData: cookieData
        //macDms: cookieData.macDms
      };
    }
  }


  async openBrowser() {
    try {
      const open = (await import('open')).default;
      await open(`http://${this.config.proxyOwnIp}:${this.config.proxyPort}`);
      this.log('Browser aperto con successo!');
    } catch (err) {
      console.error('Errore nell\'aprire il browser:', err);
    }
  }
}

module.exports = EchoConnect;