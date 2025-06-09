// This file uses the alexa-remote library (https://github.com/Apollon77/alexa-remote)
// distributed under the MIT License.

'use strict';

const Alexa = require('alexa-remote2');
const EventEmitter = require('events');
const Os = require('os');
const Crypto = require('crypto');

// Configurazioni centralizzate
const CONFIG = {
  APP_NAME: 'Echo for Homey',
  ALEXA_CALL_TIMEOUT: 2000,
  ALEXA_CALL_CLEANUP_INTERVAL: 30000,
  DEVICE_CLEANUP_THRESHOLD: 300000, // 5 minuti
  DEFAULT_ROUTINES_LIMIT: 2000,
  PROXY_PORT: 3000,
  PROXY_LANGUAGE: 'en_EN'
};

const DEVICE_FAMILIES = {
  ECHO: ["KNIGHT", "ECHO"],
  GROUP: ["WHA"]
};

const COMMAND_TYPES = {
  SPEAK: 'speak',
  WHISPER: 'whisper',
  ANNOUNCE: 'announce'
};


class AlexaError extends Error {
  constructor(code, text, originalError = null) {
    super(text);
    this.name = 'AlexaError';
    this.code = code;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
    
    // Maintain the original error's stack trace if present
    if (originalError && originalError.stack) {
      this.stack = originalError.stack;
    }
  }
  
  /**
   * Returns a JSON representation of the error
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      originalError: this.originalError?.message || null
    };
  }
}


class EchoConnect extends EventEmitter {
  constructor(showLog = false) {
    super();

    this.alexa = new Alexa();
    this.loginUrl = null;
    this.newLogIn = false;
    this.showLog = showLog;
    this.config = '';
    this.amazonPage = 'amazon.de';
    
    // Enhanced tracking system for Alexa calls
    this.alexaCallTracker = new Map(); // deviceSerial -> { events: [], timeout: timeoutId }
    this.ALEXA_CALL_TIMEOUT = CONFIG.ALEXA_CALL_TIMEOUT;
    this.ALEXA_CALL_CLEANUP_INTERVAL = CONFIG.ALEXA_CALL_CLEANUP_INTERVAL;
    
    // Global cooldown system for alexaCalled (8 seconds)
    this.globalCooldownActive = false;
    this.globalCooldownTimeout = null;
    this.GLOBAL_COOLDOWN_DURATION = 8000; // 8 seconds
    this.winningDevice = null;
    
    this._registerAlexaListeners();
    this._startPeriodicCleanup();
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
      console.log(`%c${timestamp}`, 'color: green', `[ECHO-CONNECT] -`, ...args);
    }
  }

  /**
   * Simplified tracking for Alexa calls - detects equalizer + volume sequence.
   * This is an internal method used to track events that indicate Alexa has been called.
   * Now includes global cooldown to prevent multiple device triggers.
   * 
   * @private
   * @param {string} deviceSerial - The device serial number
   * @param {string} eventType - The event type (PUSH_VOLUME_CHANGE or PUSH_EQUALIZER_STATE_CHANGE)
   * @returns {void}
   * 
   * @example
   * // This is called internally when events are detected
   * this._trackAlexaCallEvent('G092MM06336304LB', 'PUSH_EQUALIZER_STATE_CHANGE');
   * this._trackAlexaCallEvent('G092MM06336304LB', 'PUSH_VOLUME_CHANGE');
   * // When both events are detected, 'alexaCalled' event is emitted (if not in cooldown)
   */
  _trackAlexaCallEvent(deviceSerial, eventType) {
    const now = Date.now();

    // If global cooldown is active, ignore all events
    if (this._isGlobalCooldownActive()) {
      this._log(`[GLOBAL COOLDOWN] Ignoring event ${eventType} from device ${deviceSerial} - cooldown active (winning device: ${this.winningDevice})`);
      return;
    }

    // Initialize tracking if needed
    if (!this.alexaCallTracker.has(deviceSerial)) {
      this.alexaCallTracker.set(deviceSerial, { events: [], timeout: null });
    }

    const tracker = this.alexaCallTracker.get(deviceSerial);
    
    // Clear previous timeout if exists
    if (tracker.timeout) {
      clearTimeout(tracker.timeout);
    }

    // Add event to the list
    tracker.events.push({
      type: eventType,
      timestamp: now
    });

    this._log(`[SIMPLE TRACKING] Event: ${eventType} on device ${deviceSerial}`);

    // Keep only events from the last 3 seconds
    tracker.events = tracker.events.filter(event => (now - event.timestamp) < 3000);

    // Check if we have the complete sequence: EQUALIZER + VOLUME
    const hasEqualizer = tracker.events.some(e => e.type === 'PUSH_EQUALIZER_STATE_CHANGE');
    const hasVolume = tracker.events.some(e => e.type === 'PUSH_VOLUME_CHANGE');

    if (hasEqualizer && hasVolume && tracker.events.length >= 2) {
      // This device completed the sequence first!
      this._log(`[ALEXA CALL DETECTED] Device: ${deviceSerial} - WINNING DEVICE!`);
      
      // Activate global cooldown immediately
      this._activateGlobalCooldown(deviceSerial);
      
      // Clear all trackers except the winning one
      this._clearAllTrackersExcept(deviceSerial);
      
      // Emit the alexaCalled event
      this.emit('alexaCalled', {
        deviceSerial: deviceSerial,
        timestamp: new Date().toISOString(),
        eventsSequence: tracker.events.map(e => e.type),
        isWinningDevice: true,
        globalCooldownActive: true
      });

      // Clean the tracker for this device
      tracker.events = [];
    }

    // Set a new timeout to clean events
    tracker.timeout = setTimeout(() => {
      if (this.alexaCallTracker.has(deviceSerial)) {
        this.alexaCallTracker.get(deviceSerial).events = [];
        this._log(`[TIMEOUT] Cleared tracker for device ${deviceSerial}`);
      }
    }, this.ALEXA_CALL_TIMEOUT);
  }

  /**
   * Verifies if global cooldown is active
   * @private
   * @returns {boolean} True if cooldown is active
   */
  _isGlobalCooldownActive() {
    return this.globalCooldownActive;
  }

  /**
   * Activates global cooldown for 8 seconds
   * @private
   * @param {string} winningDeviceSerial - The device that "won"
   */
  _activateGlobalCooldown(winningDeviceSerial) {
    this.globalCooldownActive = true;
    this.winningDevice = winningDeviceSerial;
    
    this._log(`[GLOBAL COOLDOWN] Activated for 8 seconds - winning device: ${winningDeviceSerial}`);
    
    // Clear any existing timeout
    if (this.globalCooldownTimeout) {
      clearTimeout(this.globalCooldownTimeout);
    }
    
    // Set new timeout
    this.globalCooldownTimeout = setTimeout(() => {
      this._deactivateGlobalCooldown();
    }, this.GLOBAL_COOLDOWN_DURATION);
  }

  /**
   * Deactivates global cooldown
   * @private
   */
  _deactivateGlobalCooldown() {
    this.globalCooldownActive = false;
    this.winningDevice = null;
    this.globalCooldownTimeout = null;
    
    this._log(`[GLOBAL COOLDOWN] Deactivated - ready for new alexa calls`);
  }

  /**
   * Clears all trackers except the specified one
   * @private
   * @param {string} exceptDeviceSerial - Device not to clear
   */
  _clearAllTrackersExcept(exceptDeviceSerial) {
    for (const [deviceSerial, tracker] of this.alexaCallTracker.entries()) {
      if (deviceSerial !== exceptDeviceSerial) {
        // Clear timeout if exists
        if (tracker.timeout) {
          clearTimeout(tracker.timeout);
        }
        // Clear events
        tracker.events = [];
        this._log(`[CLEANUP] Cleared tracker for device ${deviceSerial} (losing device)`);
      }
    }
  }

  /**
   * Returns the global cooldown status
   * @returns {Object} Global cooldown status
   */
  getGlobalCooldownStatus() {
    return {
      active: this.globalCooldownActive,
      winningDevice: this.winningDevice,
      remainingTime: this.globalCooldownTimeout ? 
        Math.max(0, this.GLOBAL_COOLDOWN_DURATION - (Date.now() - (this.globalCooldownTimeout._idleStart || Date.now()))) : 0
    };
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
   * @fires alexaCalled - Emitted when Alexa is called based on event pattern detection with global cooldown (8 seconds)
   * @fires pushActivity - Emitted when PUSH_ACTIVITY command is received from Amazon servers
   *
   * @example
   * registerAlexaListeners();
   */
  _registerAlexaListeners() {
    // this.alexa.on('command', (command) => {
    //   this._log('_registerAlexaListeners - Command:', JSON.stringify(command, null, 2));
    // });

    // Use existing ws-equilizer-state-change event from alexa-remote for Alexa call detection  
    this.alexa.on('ws-equilizer-state-change', (payload) => {
      this._log('_registerAlexaListeners - Equalizer change:', JSON.stringify(payload, null, 2));
      
      // Track equalizer change event for Alexa call detection
      if (payload.deviceSerialNumber) {
        this._trackAlexaCallEvent(payload.deviceSerialNumber, 'PUSH_EQUALIZER_STATE_CHANGE');
      }
    });

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

      //this.cookieData = this.alexa.cookieData;


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

    // Intercept ws-volume-change event for volumeChanged emission and Alexa call detection
    this.alexa.on('ws-volume-change', async (payload) => {
      this._log('Volume change');

      try {
        const echoSerial = payload.deviceSerialNumber;
        const echoExist = await this.echoExist(echoSerial);

        if (echoExist) {
          this._log('Volume updated successfully');

          const newVolume = payload.volume;
          this.emit('volumeChanged', echoSerial, newVolume);
        }
        
        // Track volume change event for Alexa call detection
        if (payload.deviceSerialNumber) {
          this._trackAlexaCallEvent(payload.deviceSerialNumber, 'PUSH_VOLUME_CHANGE');
        }
      } catch (error) {
        console.error('error in ws-volume-change:', error);
      }
    });

    // Intercept the ws-audio-player-state-change event
    this.alexa.on('ws-audio-player-state-change', async (payload) => {
      this._log('Audio player state changed', payload);
      // this.log('User ID:', payload.destinationUserId);
      // this.log('Device serial number:', payload.deviceSerialNumber);
      // this.log('Device type:', payload.deviceType);
      // this.log('Media reference ID:', payload.mediaReferenceId);
      // this.log('Audio player state:', payload.audioPlayerState); //  'INTERRUPTED', / 'FINISHED' / 'PLAYING'
      this._log('Error:', payload.error);
      this._log('Error message:', payload.errorMessage);

      try {
        const echoSerial = payload.deviceSerialNumber;
        const echoExist = await this.echoExist(echoSerial);

        if (echoExist) {
          const info = await this.getPlayerInfo(echoSerial);

          const playerDetail = {
            serial: echoSerial,
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
            isPlayingInGroup: info?.isPlayingInLemur ?? false,
            groupMember: info?.lemurVolume?.memberVolume ?? null,
            update: new Date().toISOString(),
            error: payload.error,
            errorMessage: payload.errorMessage
          };

          this.emit('playerChanged', playerDetail);
        }
      } catch (error) {
        console.error("Error retrieving player information:", error);
      }
    });

    this.alexa.on('ws-media-queue-change', (payload) => {
      this._log('ws-media-queue-change called:', payload);

      this._log('serialNumber:', payload.deviceSerialNumber);
      this._log('changeType:', payload.changeType); // 'STATUS_CHANGED'
      this._log('playbackOrder:', payload.playBackOrder); // 'SHUFFLE_ALL' - 'NORMAL'
      this._log('loopMode:', payload.loopMode); // 'LOOP_QUEUE' - 'NORMAL' - 'DOES NOT EXIST ON ECHO'

      if (payload.changeType === 'STATUS_CHANGED') {
        this.emit('queueChanged', payload);
      };
    });

    // this.alexa.on('ws-media-progress-change', (payload) => {
    //   this.log('Media progress change');
    // });

    // this.alexa.on('ws-content-focus-change', (payload) => {
    //   this.log('Content focus change');
    // });

    // // Intercept the ws-media-change event
    // this.alexa.on('ws-media-change', (payload) => {
    //   this.log('Media content change:');
    //   this.log('User ID:', payload.destinationUserId);
    //   this.log('Device serial number:', payload.deviceSerialNumber);
    //   this.log('Device type:', payload.deviceType);
    //   this.log('New media reference ID:', payload.mediaReferenceId);
    // });
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
    this._log('getAlexaConfig called - cookiedata:', cookieData);

    const cookieExist = !this.isCookieEmptyOrNull(cookieData);
    this.amazonPage = page;

    if (!cookieExist || forceRefresh) {
      this._log('getAlexaConfig - Cookie NOT found, authentication required');
      return {
        //logger: console.log,
        proxyOnly: true,
        proxyOwnIp: this.getIPAddress(),
        proxyPort: 3000,
        amazonPageProxyLanguage: CONFIG.PROXY_LANGUAGE,
        amazonPage: page,
        baseAmazonPage: (page === 'amazon.co.jp' ? 'amazon.co.jp' : 'amazon.com'),
        acceptLanguage: CONFIG.PROXY_LANGUAGE,
        deviceAppName: CONFIG.APP_NAME,
        proxyCloseWindowHTML: this._generateCloseWindowHtmlContent(message, imageUrl)
      };
    } else {
      this._log('getAlexaConfig - Cookie founded! Authentication NOT required');
      //const cookieData = JSON.parse(Fs.readFileSync(this.cookiePath, 'utf8'));
      return {
        cookie: `${cookieData.loginCookie}; csrf=${cookieData.csrf}`,
        //logger: console.log,
        proxyOnly: false,
        amazonPage: page,
        baseAmazonPage: (page === 'amazon.co.jp' ? 'amazon.co.jp' : 'amazon.com'),
        acceptLanguage: 'en_EN',
        deviceAppName: CONFIG.APP_NAME,
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
      const bufHex = Crypto.randomFillSync(buf).toString('hex').toUpperCase(); // convert to hex = 32x 0-9A-F
      return Buffer.from(bufHex).toString('hex') + '23413249564c5635564d32573831'; // convert to hex = 64 characters that are hex of the hex id
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
   * 
   * @example
   * // Speak a message
   * await echoConnect.speakEcho('G090LF09643202VS', 'Hello, this is a test message');
   * 
   * // Whisper a message
   * await echoConnect.speakEcho('G090LF09643202VS', 'This is a whispered message', 'whisper');
   * 
   * // Make an announcement
   * await echoConnect.speakEcho('G090LF09643202VS', 'Dinner is ready!', 'announce');
   */
  speakEcho(device, message, type = COMMAND_TYPES.SPEAK) {
    return new Promise(async (resolve, reject) => {
      try {
        const validDevice = this._validateDeviceSerial(device);
        
        // Check if device exists in the system
        const deviceExists = await this.echoExist(validDevice);
        
        if (!deviceExists) {
          const error = new AlexaError('INVALID_SERIAL', `Device with serial ${validDevice} not found in your Amazon account`);
          throw error;
        }
        
        const commandMap = {
          [COMMAND_TYPES.ANNOUNCE]: 'announcement',
          [COMMAND_TYPES.WHISPER]: 'ssml',
          [COMMAND_TYPES.SPEAK]: 'speak'
        };
        const command = commandMap[type] || 'speak';

        const value = type === COMMAND_TYPES.WHISPER
          ? `<speak><amazon:effect name="whispered">${message}</amazon:effect></speak>`
          : message;

        this._log(`Sending sequence command ${command} to ${validDevice} with value ${value}`);

        this.alexa.sendSequenceCommand(validDevice, command, value, (error, result) => {
          if (error) {
            reject(new AlexaError('ERROR_SPEAK', error.message || error, error));
          } else {
            resolve(result);
          }
        });
        
      } catch (validationError) {
        // Handle validation errors (including INVALID_SERIAL)
        reject(validationError);
      }
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
          reject(new AlexaError('ERROR_COMMAND', error.message || error, error));
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
   * 
   * @example
   * // Play music
   * await echoConnect.changePlayback('G090LF09643202VS', 'play');
   * 
   * // Pause music
   * await echoConnect.changePlayback('G090LF09643202VS', 'pause');
   * 
   * // Skip to next track
   * await echoConnect.changePlayback('G090LF09643202VS', 'next');
   */
  changePlayback(serial, command, value = true) {
    this._log(`Sending playback command ${command} to ${serial} with value ${value}`);

    return new Promise((resolve, reject) => {
      this.alexa.sendCommand(serial, command, value, (error, result) => {
        if (error) {
          console.error('Error sending command:', error);
          reject(new AlexaError('ERROR_PLAYBACK', error.message || error, error));
        } else {
          this._log('Playback command sent with result:', JSON.stringify(result, null, 2));

          if (result.message === null && result.userFacingMessage === null) {
            reject(new AlexaError('ERROR_NOT_SUPPORTED', 'Function not supported by your Echo device'));
          } else {
            resolve(result);
          }
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
  getRoutinesList(limit = CONFIG.DEFAULT_ROUTINES_LIMIT) {
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
          this._log('Player info:', playerInfo);
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
    const validSerial = this._validateDeviceSerial(serial);
    const validVolume = this._validateVolumeLevel(volume);
    
    return new Promise((resolve, reject) => {
      this.alexa.sendSequenceCommand(validSerial, 'volume', validVolume, null, (error, result) => {
        if (error) {
          console.error('Error sending volume command:', error);
          reject(new AlexaError('ERROR_VOLUME', error.message || error, error));
        } else {
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
          resolve(echo[0].speakerVolume);
        } else {
          reject(new AlexaError('ERROR_VOLUME', `Serial number ${serial} not found`));
        }
      });
    });
  }

  /**
   * Sets the display power settings for an Echo device with a screen.
   * Uses the alexa-remote library's specific method for display power control.
   * 
   * @param {string} serial - The serial number of the Echo device.
   * @param {boolean} enabled - Whether the display should be on (true) or off (false).
   * @returns {Promise<Object>} A promise that resolves with the result of the operation.
   * @throws {AlexaError} If there's an error setting the display power settings.
   * 
   * @example
   * // Turn on the display
   * await echoConnect.setDisplayPowerSetting('G090LF09643202VS', true);
   * 
   * // Turn off the display
   * await echoConnect.setDisplayPowerSetting('G090LF09643202VS', false);
   */
  setDisplayPowerSetting(serial, enabled) {
    const validSerial = this._validateDeviceSerial(serial);
    
    if (typeof enabled !== 'boolean') {
      throw new AlexaError('INVALID_ENABLED_SETTING', 'Enabled setting must be a boolean');
    }

    return new Promise((resolve, reject) => {
      // Use the alexa-remote library's specific method
      this.alexa.setDisplayPowerSetting(validSerial, enabled, (error, result) => {
        if (error) {
          reject(new AlexaError('ERROR_DISPLAY_SETTING', `Error setting display power: ${error.message || error}`));
        } else {
          resolve({ 
            success: true, 
            displayPower: enabled ? 'ON' : 'OFF',
            result: result
          });
        }
      });
    });
  }

  /**
   * Gets the current display power settings for an Echo device with a screen.
   * Uses the alexa-remote library's specific method for retrieving display power state.
   * 
   * @param {string} serial - The serial number of the Echo device.
   * @returns {Promise<boolean>} A promise that resolves with the current display power state (true = ON, false = OFF).
   * @throws {AlexaError} If there's an error retrieving the display power settings.
   * 
   * @example
   * // Get current display power state
   * const isDisplayOn = await echoConnect.getDisplayPowerSetting('G090LF09643202VS');
   * console.log('Display is:', isDisplayOn ? 'ON' : 'OFF');
   */
  getDisplayPowerSetting(serial) {
    const validSerial = this._validateDeviceSerial(serial);
    
    return new Promise((resolve, reject) => {
      // Use the alexa-remote library's specific method
      this.alexa.getDisplayPowerSetting(validSerial, (error, result) => {
        if (error) {
          reject(new AlexaError('ERROR_DISPLAY_SETTING', `Error getting display power settings: ${error.message || error}`));
        } else {
          // The result is already a boolean from alexa-remote's getDisplayPowerSetting method
          resolve(result);
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
  checkAuthenticationAndPush(cookieData = this.alexa.cookieData, amazonPage = this.amazonPage) {
    this._log('checkAuthenticationAndPush called! - cookieData:');

    if (this.isCookieEmptyOrNull(cookieData)) {
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
                this.emit('pushDisconnected', false, 'Disconnected during authentication check');
                return false;
              });
          }
        } else {
          return this.initAlexa({
            cookieData: cookieData,
            amazonPage: amazonPage
          }).then(() => {
            return true; // Initialization is successful
          }).catch(error => {
            console.error('Error during Alexa initializing:', error?.message);
            this.emit('alexaDisconnected');
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
   * Finds a device by its serial number.
   * @param {string} serial - The serial number of the device to find.
   * @returns {Promise<Object|null>} A promise that resolves to the device object if found, or null if not found or an error occurs.
   * @example
   * findDevice('12345')
   *   .then(device => {
   *     if (device) {
   *       console.log('Device found:', device);
   *     } else {
   *       console.log('Device not found');
   *     }
   *   })
   *   .catch(error => {
   *     console.error('Error:', error);
   *   });
   */
  findDevice(serial) {
    return this.getDevices()
      .then(allDevices => {
        // Find the object with the desired serial number
        const device = allDevices.devices.find(device => device.serialNumber === serial);

        if (device) {
          this._log("Device found:");
          return device;
        } else {
          console.error("Device not found.");
          return null;
        }
      })
      .catch(error => {
        console.error('Error during device search:', error);
        return null;
      });
  }

  /**
   * Checks if a device is online based on its serial number.
   *
   * @param {string} serial - The serial number of the device.
   * @returns {Promise<boolean>} A promise that resolves to `true` if the device is online, `false` otherwise.
   * @example
   * const alexaRemote = new AlexaRemote();
   * const serial = 'your_device_serial_here';
   * 
   * alexaRemote.isOnLine(serial)
   *     .then(isOnline => {
   *         if (isOnline) {
   *             console.log(`The device with serial ${serial} is online.`);
   *         } else {
   *             console.log(`The device with serial ${serial} is offline.`);
   *         }
   *     })
   *     .catch(err => {
   *         console.error('Error checking device status:', err);
   *     });
   */
  isOnLine(serial) {
    return new Promise((resolve, reject) => {
      this.findDevice(serial)
        .then(dev => {
          if (dev && (dev.online === true || dev.online === undefined)) {
            resolve(true);
          } else {
            resolve(false);
          }
        })
        .catch(err => {
          reject(err);
        });
    });
  }

  getDevices() {
    return new Promise((resolve, reject) => {
      this.alexa.getDevices((err, devices) => {
        if (err) {
          reject(err);
        } else {
          resolve(devices);
        }
      });
    });
  }


  /**
   * Retrieves Echo devices from the list of devices.
   * 
   * @returns {Promise<Array>} A promise that resolves to an array of Echo devices.
   * @example
   * getEchoDevices().then(echoDevices => {
   *   console.log(echoDevices);
   * });
   */
  getEchoDevices() {
    return this.getDevices()
      .then(devices => {
        // Filter devices to include only those that belong to the Echo family
        const echoDevices = devices.devices.filter(device =>
          DEVICE_FAMILIES.ECHO.includes(device.deviceFamily)
        );
        return echoDevices;
      });
  }


  /**
   * Checks if an Echo device with the given serial number exists.
   * 
   * @param {string} serial - The serial number of the Echo device.
   * @returns {Promise<boolean>} A promise that resolves to true if the Echo device exists, otherwise false.
   * @example
   * echoConnect.echoExist('1234567890')
   *   .then(exists => {
   *     if (exists) {
   *       console.log('Echo device exists.');
   *     } else {
   *       console.log('Echo device does not exist.');
   *     }
   *   });
   */
  echoExist(serial) {
    return this.getDevices()
      .then(devices => {
        const combinedFamily = [...DEVICE_FAMILIES.ECHO, ...DEVICE_FAMILIES.GROUP];
        const echoDevices = devices.devices.filter(device =>
          combinedFamily.includes(device.deviceFamily)
        );
        return echoDevices.some(device => device.serialNumber === serial);
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
   * @param {number} [options.maxRetries=2] - Maximum number of retry attempts.
   * @returns {Promise<Array>} A promise that resolves when initialization is complete with the list of echo devices.
   * @throws {AlexaError} If unable to initialize Alexa after multiple attempts or if there's an error recovering devices.
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
    retryCount = 0,
    maxRetries = 2
  } = {}) {

    this._log('initAlexa called!');

    // Parameter validation
    if (retryCount < 0 || maxRetries < 0) {
      throw new AlexaError('INVALID_PARAMS', 'Retry counts must be non-negative numbers');
    }

    try {
      this.config = this._getAlexaConfig(
        cookieData,
        amazonPage,
        forceToken,
        closeWindowMessage,
        closeWindowImageUrl
      );

      return new Promise((resolve, reject) => {
        this.alexa.init(this.config, async (err) => {
          if (err) {
            await this._handleInitError(err, {
              cookieData, amazonPage, closeWindowMessage, 
              closeWindowImageUrl, retryCount, maxRetries
            }, resolve, reject);
          } else {
            await this._handleInitSuccess(resolve, reject);
          }
        });
      });
    } catch (error) {
      throw new AlexaError('ERROR_INIT', 'Failed to initialize Alexa configuration', error);
    }
  }

  /**
   * Gestisce gli errori durante l'inizializzazione
   * @private
   */
  async _handleInitError(err, options, resolve, reject) {
    console.error('Error during Alexa initialization:', err?.message);

    const cookieExist = !this.isCookieEmptyOrNull(options.cookieData);
    
    if (cookieExist && options.retryCount < options.maxRetries) {
      this._log(`Retrying initialization (attempt ${options.retryCount + 1}/${options.maxRetries})`);
      
      try {
        const result = await this.initAlexa({
          cookieData: '',
          amazonPage: options.amazonPage,
          forceToken: true,
          closeWindowMessage: options.closeWindowMessage,
          closeWindowImageUrl: options.closeWindowImageUrl,
          retryCount: options.retryCount + 1,
          maxRetries: options.maxRetries
        });
        resolve(result);
      } catch (retryError) {
        reject(retryError);
      }
    } else if (!cookieExist) {
      this._handleNewLogin(reject);
    } else {
      reject(new AlexaError('ERROR_INIT', 'Unable to initialize Alexa after multiple attempts', err));
    }
  }

  /**
   * Gestisce il caso di nuovo login richiesto
   * @private
   */
  _handleNewLogin(reject) {
    this.newLogIn = true;
    this.loginUrl = `http://${this.config.proxyOwnIp}:${this.config.proxyPort}`;
    reject(new AlexaError('ERROR_INIT', `Token not found. Please connect to: ${this.loginUrl}`));
  }

  /**
   * Gestisce il successo dell'inizializzazione
   * @private
   */
  async _handleInitSuccess(resolve, reject) {
    this._log('Alexa initialized successfully');

    try {
      const devices = await new Promise((res, rej) => {
        this.alexa.getDevices((err, devices) => {
          if (err) rej(err);
          else res(devices);
        });
      });

      this._log('Devices recovered');

      const echoDevices = devices.devices.filter(device =>
        DEVICE_FAMILIES.ECHO.includes(device.deviceFamily)
      );

      this.emit('alexaConnected', echoDevices);
      resolve(echoDevices);
    } catch (error) {
      console.error('Error recovering devices:', error);
      reject(new AlexaError('ERROR_INIT', 'Failed to recover devices', error));
    }
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
    // Check if the string is null or undefined
    if (cookieData === null || cookieData === undefined || cookieData === "null") {
      return true;
    }

    // Check if the string is empty or contains only whitespace
    if (typeof cookieData === "string" && cookieData.trim().length === 0) {
      return true;
    }

    try {
      // Try to parse the JSON string
      const jsonObject = JSON.parse(cookieData);

      // Check if the JSON object is empty
      return Object.keys(jsonObject).length === 0;
    } catch (error) {
      // If parsing fails, the string is not valid JSON
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

  /**
   * Avvia la pulizia periodica dei tracker inattivi
   * @private
   */
  _startPeriodicCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [deviceSerial, tracker] of this.alexaCallTracker.entries()) {
        // Remove inactive trackers older than 5 minutes
        const hasRecentEvents = tracker.events.some(event => 
          (now - event.timestamp) < CONFIG.DEVICE_CLEANUP_THRESHOLD
        );
        
        if (!hasRecentEvents && tracker.events.length === 0) {
          this.alexaCallTracker.delete(deviceSerial);
          this._log(`[CLEANUP] Removed inactive tracker for device ${deviceSerial}`);
        }
      }
      
      // Debug log for global cooldown if active
      if (this.globalCooldownActive) {
        const status = this.getGlobalCooldownStatus();
        this._log(`[CLEANUP] Global cooldown active - winning device: ${status.winningDevice}, remaining: ${Math.round(status.remainingTime/1000)}s`);
      }
    }, this.ALEXA_CALL_CLEANUP_INTERVAL);
  }

  /**
   * Validates device serial number
   * @private
   */
  _validateDeviceSerial(serial) {
    if (!serial || typeof serial !== 'string' || serial.trim().length === 0) {
      throw new AlexaError('INVALID_SERIAL', 'Device serial number is required and must be a non-empty string');
    }
    return serial.trim();
  }

  /**
   * Validates volume level
   * @private
   */
  _validateVolumeLevel(volume) {
    const numVolume = Number(volume);
    if (isNaN(numVolume) || numVolume < 0 || numVolume > 100) {
      throw new AlexaError('INVALID_VOLUME', 'Volume must be a number between 0 and 100');
    }
    return numVolume;
  }

  /**
   * Cleans up all resources and closes connections
   */
  destroy() {
    this._log('Destroying EchoConnect instance...');
    
    // Pulisci interval di cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Clean up global cooldown timeout
    if (this.globalCooldownTimeout) {
      clearTimeout(this.globalCooldownTimeout);
      this.globalCooldownTimeout = null;
    }
    
    // Reset global cooldown state
    this.globalCooldownActive = false;
    this.winningDevice = null;
    
    // Clear all tracker timeouts
    for (const tracker of this.alexaCallTracker.values()) {
      if (tracker.timeout) {
        clearTimeout(tracker.timeout);
      }
    }
    
    // Clear the tracker
    this.alexaCallTracker.clear();
    
    // Disconnetti push se connesso
    if (this.isPushConnected()) {
      this.stopPushMessage();
    }
    
    // Rimuovi tutti i listener
    this.removeAllListeners();
    
    this._log('EchoConnect instance destroyed');
  }

}

module.exports = {
  EchoConnect,
  AlexaError
};