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

  /**
   * Logs messages to the console if logging is enabled.
   *
   * @param {...any} args - The arguments to log.
   *
   * @example
   * log('This is a debug message');
   */
  log(...args) {
    if (this.showLog) {
      const timestamp = new Date().toISOString();
      const message = args.join(' ');
      console.log(`[DEBUG] ${timestamp} - ${message}`);
    }
  }

  /**
   * Registers listeners for Alexa-related events using the alexa-remote library.
   *
   * @returns {void}
   *
   * @fires cookieGenerated
   * @fires pushConnected
   * @fires pushDisconnected
   * @fires volumeChanged
   *
   * @example
   * registerAlexaListeners();
   */
  registerAlexaListeners() {
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

  /**
   * Generates and returns the Amazon login URL and related authentication details.
   *
   * @returns {Object} An object containing the login URL, device ID, code verifier, and code challenge.
   * @property {string} loginUrl - The generated Amazon login URL.
   * @property {string} deviceId - The device ID used for authentication.
   * @property {string} codeVerifier - The code verifier for PKCE authentication.
   * @property {string} codeChallenge - The code challenge for PKCE authentication.
   *
   * @example
   * const amazonDetails = getAmazonUrl();
   * console.log(amazonDetails.loginUrl);
   */
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

  /**
   * Retrieves the local IPv4 address of the machine.
   *
   * @returns {string} The local IPv4 address, or '0.0.0.0' if none is found.
   *
   * @example
   * const ipAddress = getIPAddress();
   * console.log('Local IP Address:', ipAddress);
   */
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

  /**
   * Saves all the extracted devices in a JSON file.
   *
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If there's an error saving the devices.
   *
   * @example
   * try {
   *   await saveAllDevices();
   *   console.log('Devices saved successfully!');
   * } catch (error) {
   *   console.error('Error saving devices:', error);
   * }
   */
  async saveAllDevices() {
    try {
      await AsyncFs.writeFile('alexa-devices.json', JSON.stringify(this.devices, null, 2));
      this.log('Dispositivi salvati con successo!');
    } catch (err) {
      console.error('Errore nel salvataggio dei dispositivi:', err);
    }
  }

  /**
   * Sends a voice command to the specified Alexa device.
   * 
   * @async
   * @param {string} device - The identifier of the Alexa device.
   * @param {string} message - The message to be spoken or announced.
   * @param {'speak' | 'whisper' | 'announce'} [type='speak'] - The type of voice command. Defaults to 'speak'.
   * @returns {Promise<any>} A promise that resolves with the result of the command.
   * @throws {Error} If an error occurs while sending the command.
   */
  async speakEcho(device, message, type = 'speak') {
    const command = (() => {
      switch (type) {
        case 'announce':
          return 'announcement';
        case 'whisper':
          return 'ssml';
        default:
          return 'speak';
      }
    })();

    const value = type === 'whisper'
      ? `<speak><amazon:effect name="whispered">${message}</amazon:effect></speak>`
      : message;

    this.log(`Sending sequence command ${command} to ${device} with value ${value}`);

    try {
      return await new Promise((resolve, reject) => {
        this.alexa.sendSequenceCommand(device, command, value, (error, result) => (error ? reject(error) : resolve(result)));
      });
    } catch (e) {
      throw e;
    }
  }S

  /**
   * Sends an Alexa command to a specific Echo device.
   *
   * @async
   * @param {string} serial - Serial ID of the Echo device.
   * @param {string} command - Alexa command to execute.
   * @returns {Promise<void>}
   * @throws {Error} If there's an error executing the Alexa command.
   *
   * @example
   * await executeAlexaCommand('ABC123', 'What's the weather?');
   */
  async executeAlexaCommand(serial, command) {
    try {
      await this.alexa.sendSequenceCommand(serial, 'textCommand', command);
    } catch (err) {
      console.error('Error executing Alexa command:', err);
    }
  }

  /**
   * Manages music playback on an Echo device.
   *
   * @async
   * @param {string} serial - Serial ID of the Echo device.
   * @param {('play'|'pause'|'next'|'previous'|'repeat'|'shuffle')} action - Playback action to perform.
   * @param {boolean} [value=true] - Value for the action (used for repeat and shuffle).
   * @returns {Promise<void>}
   *
   * @example
   * await changePlayback('ABC123', 'play');
   */
  async changePlayback(serial, action, value = true) {
    return this.alexa.sendCommand(serial, action, value);
  };

  /**
   * Converts a callback-based function to a Promise-based function.
   *
   * @param {Function} fn - The function to promisify.
   * @param {Object} options - Options to pass to the function.
   * @returns {Promise<any>} A promise that resolves with the result of the function.
   *
   * @example
   * const result = await promisifyWithOptions(someCallbackFunction, { option1: 'value1' });
   */
  promisifyWithOptions(fn, options) {
    return new Promise((resolve, reject) => {
      fn(options, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Gets player information for a specific Echo device.
   *
   * @async
   * @param {string} serial - Serial ID of the Echo device.
   * @returns {Promise<Object>} An object containing player information.
   *
   * @example
   * const playerInfo = await getPlayerInfo('ABC123');
   * console.log(playerInfo);
   */
  async getPlayerInfo(serial) {
    this.log(`Getting player info for ${serial}`);
    const { playerInfo } = await this.promisifyWithOptions(this.alexa.getPlayerInfo.bind(this.alexa), serial);

    return {
      id: serial,
      playing: playerInfo?.state === 'PLAYING',
      volume: isNaN(playerInfo?.volume?.volume) ? undefined : playerInfo?.volume?.volume / 100,
      shuffle: {
        ENABLED: true,
        DISABLED: false,
        HIDDEN: 'disabled'
      }[playerInfo?.transport?.shuffle],
      repeat: {
        ENABLED: 'playlist',
        DISABLED: 'none',
        HIDDEN: 'disabled'
      }[playerInfo?.transport?.repeat],
      media: {
        artwork: playerInfo?.mainArt?.url ?? '',
        track: playerInfo?.infoText?.title ?? '',
        artist: playerInfo?.infoText?.subText1 ?? '',
        album: playerInfo?.infoText?.subText2 ?? ''
      }
    };
  };


  /**
   * Sets the volume of an Echo device.
   *
   * @async
   * @param {string} serial - Serial ID of the Echo device.
   * @param {number} volume - The volume level to set (0-100).
   * @returns {Promise<void>}
   * @throws {Error} If there's an error sending the volume command.
   *
   * @example
   * await setVolumeDevice('ABC123', 50);
   */
  async setVolumeDevice(serial, volume) {
    try {
      await this.alexa.sendSequenceCommand(serial, 'volume', volume);
      this.updateVolumeArray(serial, volume);
    } catch (err) {
      console.error('Error sending volume command:', err);
    }
  }

  /**
   * Updates the volume of an Echo device in the devices array.
   *
   * @param {string} serial - The serial number of the Echo device.
   * @param {number} volume - The new volume level to set.
   * @returns {boolean} True if the update was successful, false if the device was not found.
   *
   * @example
   * const updated = updateVolumeArray('ABC123', 50);
   * if (updated) {
   *   console.log('Volume updated successfully');
   * } else {
   *   console.log('Device not found');
   * }
   */
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

  /**
   * Retrieves the volume of a specific Alexa device.
   *
   * @param {string} serial - The serial number of the Alexa device.
   * @returns {Promise<number>} A Promise that resolves with the device's volume.
   * @throws {Error} If an error occurs while retrieving the volume or if the device is not found.
   *
   * @example
   * getVolumeDevice('ABC123XYZ')
   *   .then(volume => console.log(`The device volume is: ${volume}`))
   *   .catch(error => console.error(`Error: ${error.message}`));
   */
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

  /**
   * Initializes the push message connection for Alexa updates.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves when the push connection is successfully initialized.
   * @throws {Error} If there's an error initializing the push updates.
   *
   * @example
   * try {
   *   await initPushMessage();
   *   console.log('Push message connection initialized successfully');
   * } catch (error) {
   *   console.error('Failed to initialize push message connection:', error);
   * }
   */
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

  /**
   * Checks if the push connection for device status updates is active.
   *
   * @returns {boolean} True if the push connection is active, false otherwise.
   *
   * @example
   * if (isPushConnected()) {
   *   console.log('Push connection is active');
   * } else {
   *   console.log('Push connection is not active');
   * }
   */
  isPushConnected() {
    return this.alexa.isPushConnected() === true || false;
  }

  /**
   * Stops receiving push message updates from Alexa devices.
   * Emits a 'pushDisconnected' event when the connection is stopped.
   *
   * @fires pushDisconnected
   *
   * @example
   * stopPushMessage();
   * console.log('Push message updates stopped');
   */
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

  /**
   * Checks if the connection to Alexa is authenticated and ready.
   *
   * @async
   * @returns {Promise<boolean>} A promise that resolves to true if authenticated, false otherwise.
   * @throws {Error} If an error occurs during the authentication check.
   *
   * @example
   * try {
   *   const isAuth = await isAuthenticated();
   *   console.log(isAuth ? 'Authenticated with Alexa' : 'Not authenticated with Alexa');
   * } catch (error) {
   *   console.error('Authentication check failed:', error);
   * }
   */
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

  /**
   * Finds and returns an EchoDevice object based on its serial number.
   *
   * @param {string} serial - The serial number of the Echo device to find.
   * @returns {EchoDevice|undefined} The EchoDevice object if found, undefined otherwise.
   *
   * @example
   * const device = findEchoBySerial('ABC123XYZ');
   * if (device) {
   *   console.log('Device found:', device.name);
   * } else {
   *   console.log('Device not found');
   * }
   */
  findEchoBySerial(serial) {
    return this.arrayDevices.find(echoDevice => echoDevice.getSerial() === serial);
  }

  /**
   * Checks if an EchoDevice with the given serial number exists in the array.
   *
   * @param {string} serial - The serial number to check.
   * @returns {boolean} True if an EchoDevice with the given serial exists, false otherwise.
   *
   * @example
   * if (echoExist('ABC123XYZ')) {
   *   console.log('Echo device exists');
   * } else {
   *   console.log('Echo device not found');
   * }
   */
  echoExist(serial) {
    return this.arrayDevices.some(echoDevice => echoDevice.getSerial() === serial);
  }

  /**
   * Creates an array of EchoDevice objects from the filtered device information.
   *
   * @returns {EchoDevice[]} An array of EchoDevice objects.
   *
   * @example
   * const formattedDevices = filterAndFormatDevices();
   * console.log(`Found ${formattedDevices.length} compatible Echo devices`);
   */
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

  /**
   * Initializes the Alexa service.
   *
   * @async
   * @param {Object} options - The initialization options.
   * @param {string} [options.cookieData] - The cookie data for authentication.
   * @param {string} [options.amazonPage='amazon.de'] - The Amazon domain to use.
   * @param {boolean} [options.forceToken=false] - Whether to force token refresh.
   * @param {string} [options.closeWindowMessage='You can now close this window.'] - Message to display when closing the authentication window.
   * @param {string} [options.closeWindowImageUrl=''] - URL of the image to display when closing the authentication window.
   * @param {number} [options.retryCount=0] - Number of retry attempts.
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   * @throws {Error} If unable to initialize Alexa after multiple attempts or if there's an error recovering devices.
   * 
   * @fires alexaConnected
   * 
   * @example
   * initAlexa({
   *   cookieData: 'your-cookie-data',
   *   amazonPage: 'amazon.de',
   *   forceToken: true
   * })
   *   .then(() => console.log('Alexa initialized successfully'))
   *   .catch(error => console.error('Initialization failed:', error));
   */
  async initAlexa({
    cookieData,
    amazonPage = 'amazon.de',
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

  /**
   * Generates HTML content for a close window message.
   *
   * @param {string} message - The message to display.
   * @param {string} [imageUrl] - The URL of an optional image to display.
   * @returns {string} The generated HTML content.
   *
   * @example
   * const html = generateCloseWindowHtmlContent('You can close this window now', 'https://example.com/image.jpg');
   * console.log(html);
   */
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

  /**
   * Checks if the cookie data is empty, null, or an empty JSON object.
   *
   * @param {string} cookieData - The cookie data to check.
   * @returns {boolean} True if the cookie data is empty or null, false otherwise.
   *
   * @example
   * if (isCookieEmptyOrNull(cookieString)) {
   *   console.log('Cookie is empty or null');
   * } else {
   *   console.log('Cookie contains data');
   * }
   */
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

  /**
   * Returns the configuration object for connecting to Alexa servers.
   *
   * @param {string} cookieData - The cookie data for authentication.
   * @param {string} page - The Amazon page to use.
   * @param {boolean} forceRefresh - Whether to force a refresh of the authentication.
   * @param {string} message - The message to display when closing the authentication window.
   * @param {string} imageUrl - The URL of an image to display when closing the authentication window.
   * @returns {Object} The Alexa configuration object.
   *
   * @example
   * const config = getAlexaConfig(cookieData, 'amazon.com', false, 'Authentication complete', 'https://example.com/image.jpg');
   * console.log(config);
   */
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

  /**
   * Opens the default browser to the Alexa authentication page.
   *
   * @async
   * @throws {Error} If there's an error opening the browser.
   *
   * @example
   * try {
   *   await openBrowser();
   *   console.log('Browser opened successfully');
   * } catch (error) {
   *   console.error('Failed to open browser:', error);
   * }
   */
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