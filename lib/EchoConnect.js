// This file uses the alexa-remote library (https://github.com/Apollon77/alexa-remote)
// distributed under the MIT License.

'use strict';

const Alexa = require('alexa-remote2');
const EventEmitter = require('events');
const EchoDevice = require('./EchoDevice');
const Os = require('os');
//const { json } = require('stream/consumers');

const deviceFamily = [
  "KNIGHT",
  "ECHO"
];

class AlexaError extends Error {
  constructor(code, text) {
    super(text);
    this.name = 'AlexaError';
    this.code = code;
  }
}


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
    this.cookieData = '';
    this.amazonPage = 'amazon.de';
    this._registerAlexaListeners();
  }

  /**
   * Logs messages to the console if logging is enabled.
   *
   * @private
   * 
   * @param {...any} args - The arguments to log.
   *
   * @example
   * log('This is a debug message');
   */
  _log(...args) {
    if (this.showLog) {
      const timestamp = new Date().toISOString();
      const message = args.join(' ');
      console.log(`[ECHO-CONNECT] ${timestamp} - ${message}`);
    }
  }

  /**
   * Registers listeners for Alexa-related events using the alexa-remote library.
   *
   * @private
   * @returns {void}
   * @fires cookieGenerated
   * @fires pushConnected
   * @fires pushDisconnected
   * @fires volumeChanged
   * @fires playerChanged
   *
   * @example
   * registerAlexaListeners();
   */
  _registerAlexaListeners() {
    // this.alexa.on('command', (command) => {
    //   this._log('_registerAlexaListeners - Command:', JSON.stringify(command, null, 2));
    // });

    this.alexa.on('cookie', (cookie, csrf, macDms) => {
      // This event is triggered when a cookie is generated OR refreshed.
      // Store these values for subsequent starts
      //
      // cookie to provide in options.cookie on next start
      // csrf belongs to cookie and both needed, but is normally extracted from cookie again on start
      // macDms needed for push connections. Provide in options.macDms on next start
      // Get alexa.cookieData and store too and provide the content in options.formerRegistrationData on next start to allow cookie refreshs
      //   You can also just store alexa.cookieData and provide this object as options.cookie, then options.formerRegistrationData is handled internally too
      this._log('cookie has been generated OR refreshed')

      this.emit('cookieGenerated', this.newLogIn, this.alexa.cookieData);
      this.newLogIn = false;
    });

    // Listener when initPushMessage is called
    this.alexa.on('ws-connect', () => {
      setTimeout(() => {
        this._log('Push message connected')

        this.emit('pushConnected');
      }, 1);
    });

    // Listener when initPushMessage is disconnected
    this.alexa.on('ws-disconnect', (willReconnect, reason) => {
      this._log('Push message disconnected')

      this.emit('pushDisconnected', willReconnect, reason);
    });

    // Intercetta l'evento ws-audio-player-state-change
    this.alexa.on('ws-volume-change', (payload) => {
      this._log('Volume change');

      const echoSerial = payload.deviceSerialNumber;

      if (this.echoExist(echoSerial)) {
        const newVolume = payload.volume;
        const updatedSuccessfully = this._updateVolumeArray(echoSerial, newVolume);

        if (updatedSuccessfully) {
          this._log('Volume updated successfully');

          this.emit('volumeChanged', echoSerial, newVolume);

        } else {
          this.error('Volume update failed!');
        }
      }
    });

    // Intercetta l'evento ws-audio-player-state-change
    this.alexa.on('ws-audio-player-state-change', async (payload) => {
      this._log('Audio player state changed');
      // this.log('ID Utente:', payload.destinationUserId);
      // this.log('Numero di serie del dispositivo:', payload.deviceSerialNumber);
      // this.log('Tipo di dispositivo:', payload.deviceType);
      // this.log('ID riferimento media:', payload.mediaReferenceId);
      // this.log('Stato del player audio:', payload.audioPlayerState); //  'INTERRUPTED', / 'FINISHED' / 'PLAYING'
      this._log('Error:', payload.error);
      this._log('Error message:', payload.errorMessage);

      const serial = payload.deviceSerialNumber;

      if (this.echoExist(serial)) {
        try {
          const info = await this.getPlayerInfo(serial);

          const playerDetail = {
            serial: serial,
            mediaId: payload.mediaReferenceId,
            state: payload.audioPlayerState === 'PLAYING',
            volume: {
              level: info.volume.volume || 0,
              muted: info.muted || false
            },
            track: {
              artwork: info?.mainArt?.url ?? '',
              title: info?.infoText?.title ?? '',
              artist: info?.infoText?.subText1 ?? '',
              album: info?.infoText?.subText2 ?? '',
            },
            update: new Date().toISOString(),
            error: payload.error,
            errorMessage: payload.errorMessage
          };

          this.emit('playerChanged', playerDetail);

        } catch (error) {
          console.error("Errore nel recupero delle informazioni:", error);
        }


      }
    });

    this.alexa.on('ws-media-queue-change', (payload) => {
      this._log('ws-media-queue-change called - status:', payload.changeType);

      this._log('serialNumber:', payload.deviceSerialNumber);
      this._log('changeType:', payload.changeType); // 'STATUS_CHANGED'
      this._log('playbackOrder:', payload.playBackOrder); // 'SHUFFLE_ALL' - 'NORMAL'
      this._log('loopMode:', payload.loopMode); // 'LOOP_QUEUE' - 'NORMAL' - 'SU ECHO NON ESISTE'

      if (payload.changeType === 'STATUS_CHANGED') {
        this.emit('queueChanged', payload);
      };
    });

    // this.alexa.on('ws-media-progress-change', (payload) => {
    //   this.log('Cambio ws-media-progress-change');
    // });

    // this.alexa.on('ws-content-focus-change', (payload) => {
    //   this.log('Cambio ws-content-focus-change');
    // });

    // // Intercetta l'evento ws-media-change
    // this.alexa.on('ws-media-change', (payload) => {
    //   this.log('Cambio del contenuto multimediale:');
    //   this.log('ID Utente:', payload.destinationUserId);
    //   this.log('Numero di serie del dispositivo:', payload.deviceSerialNumber);
    //   this.log('Tipo di dispositivo:', payload.deviceType);
    //   this.log('Nuovo ID riferimento media:', payload.mediaReferenceId);
    // });
  }

  /**
   * Retrieves the local IPv4 address of the machine.
   * 
   * @private
   * @returns {string} The local IPv4 address, or '0.0.0.0' if none is found.
   *
   * @example
   * const ipAddress = getIPAddress();
   * console.log('Local IP Address:', ipAddress);
   */
  _getIPAddress() {
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
   * Updates the volume of an Echo device in the devices array.
   * 
   * @private
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
  _updateVolumeArray(serial, volume) {
    const index = this.arrayDevices.findIndex(p => p.getSerial() === serial);
    if (index !== -1) {
      this.arrayDevices[index].setVolume(volume);
      this._log(`Array - Updated volume for device ${this.arrayDevices[index].name}: ${volume}`);
      return true;
    } else {
      this._log(`Array - No device found for the serial ${serial}`);
      return false;
    }
  }

  /**
   * Creates an array of EchoDevice objects from the filtered device information.
   *
   * @private
   * @returns {EchoDevice[]} An array of EchoDevice objects.
   *
   * @example
   * const formattedDevices = filterAndFormatDevices();
   * console.log(`Found ${formattedDevices.length} compatible Echo devices`);
   */
  _filterAndFormatDevices() {
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
   * Generates HTML content for a close window message.
   *
   * @private
   * @param {string} message - The message to display.
   * @param {string} [imageUrl] - The URL of an optional image to display.
   * @returns {string} The generated HTML content.
   *
   * @example
   * const html = generateCloseWindowHtmlContent('You can close this window now', 'https://example.com/image.jpg');
   * console.log(html);
   */
  _generateCloseWindowHtmlContent(message, imageUrl) {
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
   * Returns the configuration object for connecting to Alexa servers.
   *
   * @private
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
  _getAlexaConfig(cookieData, page, forceRefresh, message, imageUrl) {
    this._log('getAlexaConfig called');

    this.cookieExist = !this.isCookieEmptyOrNull(cookieData);
    this.cookieData = cookieData;
    this.amazonPage = page;

    if (!this.cookieExist || forceRefresh) {
      this._log('Cookie NOT found, authentication required');
      return {
        //logger: console.log,
        proxyOnly: true,
        proxyOwnIp: this._getIPAddress(),
        proxyPort: 3000,
        amazonPageProxyLanguage: 'en_EN',
        amazonPage: page,
        baseAmazonPage: (page === 'amazon.co.jp' ? 'amazon.co.jp' : 'amazon.com'),
        acceptLanguage: 'en_EN',
        proxyCloseWindowHTML: this._generateCloseWindowHtmlContent(message, imageUrl)
      };
    } else {
      this._log('Cookie trovato! Non serve autenticarsi');
      //const cookieData = JSON.parse(Fs.readFileSync(this.cookiePath, 'utf8'));
      return {
        cookie: `${cookieData.loginCookie}; csrf=${cookieData.csrf}`,
        //logger: console.log,
        proxyOnly: false,
        amazonPage: page,
        baseAmazonPage: (page === 'amazon.co.jp' ? 'amazon.co.jp' : 'amazon.com'),
        acceptLanguage: 'en_EN',
        formerRegistrationData: cookieData
        //macDms: cookieData.macDms
      };
    }
  }

  /**
   * Extracts the error message from a given string.
   * The function looks for the last occurrence of "error = " and returns the text following it.
   * 
   * @param {string} str - The input string containing the error message.
   * @returns {string|null} The extracted error message without surrounding quotes, or null if not found.
   * 
   * @example
   * const input = "[ManagerDrivers] Error: Some exception, error = 'Device not found'";
   * const errorMessage = extractErrorMessage(input);
   * console.log(errorMessage); // Output: "Device not found"
   */
  _extractErrorMessage(err) {
    const errorPrefix = "error = ";
    const startIndex = err.lastIndexOf(errorPrefix);
    if (startIndex !== -1) {
      return err.slice(startIndex + errorPrefix.length).trim().replace(/^'|'$/g, '');
    }
    return null;
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
   * Sends a voice command to the specified Alexa device.
   * 
   * @param {string} device - The identifier of the Alexa device.
   * @param {string} message - The message to be spoken or announced.
   * @param {'speak' | 'whisper' | 'announce'} [type='speak'] - The type of voice command. Defaults to 'speak'.
   * @returns {Promise<any>} A promise that resolves with the result of the command.
   * @throws {Error} If an error occurs while sending the command.
   */
  speakEcho(device, message, type = 'speak') {
    const commandMap = {
      announce: 'announcement',
      whisper: 'ssml',
      speak: 'speak'
    };
    const command = commandMap[type] || 'speak';

    const value = type === 'whisper'
      ? `<speak><amazon:effect name="whispered">${message}</amazon:effect></speak>`
      : message;

    this._log(`Sending sequence command ${command} to ${device} with value ${value}`);

    return new Promise((resolve, reject) => {
      this.alexa.sendSequenceCommand(device, command, value, (error, result) => {
        if (error) reject(new AlexaError('ERROR_SPEAK', error));
        else resolve(result);
      });
    });
  }

  /**
   * Sends an Alexa command to a specific Echo device.
   *
   * @param {string} serial - The serial number of the Alexa device.
   * @param {string} command - The text command to be executed.
   * @returns {Promise<any>} A promise that resolves with the result of the command execution.
   * @throws {Error} If there's an error during command execution.
   *
   * @example
   * try {
   *   const result = await this.executeAlexaCommand('DEVICE_SERIAL', 'play music');
   *   console.log('Command executed successfully:', result);
   * } catch (error) {
   *   console.error('Error executing command:', error);
   * }
   */
  executeAlexaCommand(serial, command) {
    return new Promise((resolve, reject) => {
      this.alexa.sendSequenceCommand(serial, 'textCommand', command, (error, result) => {
        if (error) {
          reject(new AlexaError('ERROR_COMMAND', error));
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Sends a playback command to an Alexa device and handles the response.
   * 
   * @param {string} serial - The serial number of the Alexa device.
   * @param {('play'|'pause'|'next'|'previous'|'repeat'|'shuffle')} command - Playback action to perform.
   * @param {boolean} [value=true] - The value associated with the command (optional, defaults to true).
   * @returns {Promise<any>} A promise that resolves with the result of the command or rejects with an error.
   */
  changePlayback(serial, command, value = true) {
    this._log(`Sending playback command ${command} to ${serial} with value ${value}`);
    
    return new Promise((resolve, reject) => {
      this.alexa.sendCommand(serial, command, value, (error, result) => {
        if (error) {
          console.error('Error sending command:', error);
          reject(new AlexaError('ERROR_PLAYBACK', error));
        } else {
          this._log('Command sent successfully:', JSON.stringify(result, null, 2));
          resolve(result);
        }
      });
    });
  }

  /**
   * Retrieves the list of audio groups.
   * 
   * @returns {Promise<Array>} A promise that resolves with the list of audio groups.
   * @example
   * // Get all audio groups
   * const audioGroups = await device.getAudioGroupsList();
   * console.log(audioGroups);
   * // Output: [{ id: '123', name: 'Living Room Group' }, { id: '456', name: 'Bedroom Group' }]
   */
  getAudioGroupsList() {
    return new Promise((resolve, reject) => {
      this.alexa.getWholeHomeAudioGroups((error, groups) => {
        if (error) {
          reject(new AlexaError('ERROR_GROUP', error));
        } else {
          resolve(groups);
        }
      });
    });
  }

  /**
   * Retrieves the list of routines.
   * 
   * @param {number} [limit=2000] - The maximum number of routines to retrieve.
   * @returns {Promise<Array>} A promise that resolves with the list of routines.
   * @example
   * // Get up to 100 routines
   * const routines = await device.getRoutinesList(100);
   * console.log(routines);
   * // Output: [{ id: 'routine1', name: 'Good Morning' }, { id: 'routine2', name: 'Goodnight' }]
   */
  getRoutinesList(limit = 2000) {
    return new Promise((resolve, reject) => {
      this.alexa.getAutomationRoutines(limit, (error, result) => {
        if (error) {
          reject(new AlexaError('ERROR_ROUTINE', error));
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Executes an automation routine on a specific device.
   * 
   * @param {string} serial - The serial number of the Alexa device.
   * @param {Object} routine - The routine to execute.
   * @returns {Promise<Object>} A promise that resolves with the result of the execution.
   * @example
   * // Execute a routine
   * const routineToExecute = { id: 'routine1', name: 'Good Morning' };
   * const result = await device.executeAutomationRoutine('DEVICE_SERIAL_NUMBER', routineToExecute);
   * console.log(result);
   * // Output: { status: 'success', message: 'Routine executed successfully' }
   */
  executeAutomationRoutine(serial, routine) {
    return new Promise((resolve, reject) => {
      this.alexa.executeAutomationRoutine(serial, routine, (error, result) => {
        if (error) {
          reject(new AlexaError('ERROR_ROUTINE', error));
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Retrieves player information for a specific device.
   * 
   * @param {string} serial - The serial number of the Alexa device.
   * @returns {Promise<Object>} A promise that resolves with the player information.
   * @example
   * // Get player info for a device
   * const playerInfo = await device.getPlayerInfo('DEVICE_SERIAL_NUMBER');
   * console.log(playerInfo);
   * // Output: { state: 'PLAYING', volume: 50, muted: false, mediaId: 'song123' }
   */
  getPlayerInfo(serial) {
    return new Promise((resolve, reject) => {
      this.alexa.getPlayerInfo(serial, (error, playerInfo) => {
        if (error) {
          reject(new AlexaError('ERROR_PLAYER', error));
        } else {
          resolve(playerInfo.playerInfo);
        }
      });
    });
  }


  /**
   * Creates an Alexa notification and sends it to the Alexa service.
   * 
   * @param {string} serial - The serial number or name of the Alexa device.
   * @param {'Reminder' | 'Alarm'} type - The type of notification (e.g., "Reminder", "Alarm").
   * @param {string} label - The label for the notification.
   * @param {*} value - The value for the notification (e.g., time for an alarm).
   * @param {'ON' | 'OFF'} [statu='ON'] - The status of the notification ("ON" or "OFF").
   * @returns {Promise<Object>} A promise that resolves with the response from the Alexa service.
   * 
   * @example
   * createAlexaNotification("G090LF09643202VS", "Reminder", "Take medicine", new Date().getTime() + 3600000, "ON")
   *   .then(response => console.log("Notification created:", response))
   *   .catch(error => console.error("Error creating notification:", error));
   */
  createAlexaNotification(serial, type, label, value, status = "ON") {
    return new Promise((resolve, reject) => {
      // Create the notification object
      const notification = this.alexa.createNotificationObject(
        serial,
        type,
        label,
        value,
        status
      );

      // If the creation of the notification object fails, terminate here
      if (!notification) {
        reject(new AlexaError('ERROR_NOTIFICATION', 'Unable to create notification object'));
        return;
      }

      // Use createNotification with a callback
      this.alexa.createNotification(notification, (error, response) => {
        if (error) {
          reject(new AlexaError('ERROR_NOTIFICATION', error));
        } else {
          if (response.hasOwnProperty('message') &&
            typeof response.message === 'string' &&
            response.message.toLowerCase().includes('error')) {

            const err = this._extractErrorMessage(response.message);
            reject(new AlexaError('ERROR_NOTIFICATION', 'Error: ' + err));
          } else {

            resolve(response);
          }
        }
      });
    });
  }


  /**
   * Sets the volume of an Echo device.
   *
   * @param {string} serial - Serial ID of the Echo device.
   * @param {number} volume - The volume level to set (0-100).
   * @returns {Promise<void>}
   * @throws {Error} If there's an error sending the volume command.
   *
   * @example
   * await setVolumeDevice('ABC123', 50);
   */
  setVolumeDevice(serial, volume) {
    return new Promise((resolve, reject) => {
      this.alexa.sendSequenceCommand(serial, 'volume', volume, null, (error, result) => {
        if (error) {
          console.error('Error sending volume command:', error);
          reject(new AlexaError('ERROR_VOLUME', error));
        } else {
          this._updateVolumeArray(serial, volume);
          resolve(result);
        }
      });
    });
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
          reject(new AlexaError('ERROR_VOLUME', `Error recovering device volume: ${err.message}`));
          return;
        }

        const echo = state.volumes.filter(volume => volume.dsn === serial);

        if (echo.length > 0) {
          this._updateVolumeArray(serial, echo[0].speakerVolume)
          resolve(echo[0].speakerVolume);
        } else {
          reject(new AlexaError('ERROR_VOLUME', `Serial number ${serial} not found`));
        }
      });
    });
  }

  /**
   * Initializes the push message connection for Alexa updates.
   *
   * @returns {Promise<void>} A promise that resolves when the push connection is successfully initialized.
   *
   * @example
   * try {
   *   await initPushMessage();
   *   console.log('Push message connection initialized successfully');
   * } catch (error) {
   *   console.error('Failed to initialize push message connection:', error);
   * }
   */
  initPushMessage() {
    this._log('initPushMessage called!');
    return new Promise((resolve, reject) => {
      this.alexa.initPushConnection((err) => {
        if (err) {
          this._log('Error initializing push updates');
          reject(new AlexaError('ERROR_PUSH', err));
        } else {
          this._log('Push update initialization completed');
          resolve();
        }
      });
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

    this._log('Push message from Echo disconnected manually');

    this.emit('pushDisconnected', false, 'Disconnected by the user');

    // } else {
    //   console.error('Push message not conected');
    // }
  }

  /**
   * Checks if the connection to Alexa is authenticated and ready.
   *
   * @returns {Promise<boolean>} A promise that resolves to true if authenticated, false otherwise.
   *
   * @example
   * try {
   *   const isAuth = await isAuthenticated();
   *   console.log(isAuth ? 'Authenticated with Alexa' : 'Not authenticated with Alexa');
   * } catch (error) {
   *   console.error('Authentication check failed:', error);
   * }
   */
  isAuthenticated() {
    return new Promise((resolve, reject) => {
      this.alexa.checkAuthentication((authenticated, err) => {
        if (err) {
          console.error('Error while verifying authentication:', err);
          reject(new AlexaError('ERROR_AUTHENTICATION', err));
        } else {
          if (authenticated) {
            this._log('Authentication with Alexa is valid');
          } else {
            this._log('Alexa authentication is invalid or has expired');
          }
          resolve(authenticated);
        }
      });
    });
  }

  /**
   * Checks if the user is authenticated and if the push connection is active.
   * If authenticated, it checks the push connection status.
   * If the push connection is not active, it initializes the push message.
   * 
   * @returns {Promise<boolean>} - Returns true if push is connected or initialized, false if not authenticated.
   * 
   * @example
   * const result = await myAlexaHandler.checkAuthenticationAndPush();
   * console.log(result); // true or false based on authentication and push connection status
   */
  checkAuthenticationAndPush() {

    if (!this.cookieExist) {
      return Promise.resolve(false);
    }
    
    return this.isAuthenticated()
      .then(authenticated => {
        // If authentication is valid
        if (authenticated) {
          // Check if push connection is active
          if (this.isPushConnected()) {
            return true; // Push connection is active
          } else {
            return this.initPushMessage()
              .then(() => {
                return true; // Return true after push initializing
              })
              .catch(error => {
                console.error('Error during push service initializing:', error);
                return false;
              });
          }
        } else {
          return this.initAlexa({
            cookieData: this.cookieData,
            amazonPage: this.amazonPage
          }).then(() => {
            return true; // Initialization is successful
          }).catch(error => {
            console.error('Error during Alexa initializing:', error);
            return false; // Authentication is definitely not valid - need a new login
          });
        }
      })
      .catch(err => {
        console.error('Error during authentication check:', err);
        return false; // Return false in case of error - need a new login
      });
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
  initAlexa({
    cookieData,
    amazonPage = 'amazon.de',
    forceToken = false,
    closeWindowMessage = 'You can now close this window.',
    closeWindowImageUrl = '',
    retryCount = 0
  } = {}) {

    this._log('initAlexa called!');

    return new Promise((resolve, reject) => {
      this.config = this._getAlexaConfig(
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
            this._log('retryCount: ', retryCount);

            if (retryCount >= 2) {
              this._log('Max number of attempts reached. Unable to initialize Alexa.');
              reject(new AlexaError('ERROR_INIT', 'Unable to initialize Alexa after multiple attempts'));
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

            reject(new AlexaError('ERROR_INIT', `Token not found. Please connect to the following link: http://${this.config.proxyOwnIp}:${this.config.proxyPort}`));
          }

          // Cookie AVAILABLE
        } else {
          this._log('Alexa initialized successfully');

          // Fill the Json this.devices
          this.alexa.getDevices((err, devices) => {

            if (err) {
              console.error('Error recovering devices:', err);

              reject(new AlexaError('ERROR_INIT', err));

            } else {
              this._log('Devices recovered');

              this.devices = devices;
              //this.saveAllDevices();

              // Fill the array with EchoDevice objects created starting from the data contained in the Json
              this.arrayDevices = this._filterAndFormatDevices();



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
   * Opens the default browser to the proxy URL.
   * 
   * @returns {Promise<void>} A promise that resolves when the browser is opened successfully.
   * @throws {Error} If there's an error opening the browser.
   */
  async openBrowser() {
    try {
      const { default: open } = await import('open');
      const url = `http://${this.config.proxyOwnIp}:${this.config.proxyPort}`;
      await open(url);
      this._log('Browser opened successfully!');
    } catch (err) {
      this._log('Error opening browser:', err);
      throw err; // We throw the error to allow the caller to handle it
    }
  }

}

module.exports = {
  EchoConnect,
  AlexaError
};