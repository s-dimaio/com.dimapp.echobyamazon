'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { EchoConnect } = require('./lib/EchoConnect')
const { TaskScheduler } = require('./lib/TaskScheduler');
const FileLogger = require('./lib/FileLogger');


class EchoApp extends Homey.App {

  // Configuration constants
  static SCHEDULER_INTERVAL = 8 * 60 * 60 * 1000; // 8 hours
  static DEBUG_MODE = false;


  /**
   * Method to obtain a unique ID for the installation.
   * Generates and saves the ID in settings the first time it is called.
   * @returns {string} The unique ID for this specific installation.
   */
  _getInstallUniqueId() {
    // Check if the ID is already saved in settings
    let uniqueId = this.homey.settings.get('installUniqueId');

    if (uniqueId) {
      this.log('Installation ID found in settings (previously used).');
      return uniqueId;
    }

    // if the ID is not present (first run), generate a new one
    // We use a UUID v4, which is universally accepted as a random unique ID.
    uniqueId = crypto.randomUUID();

    this.log(`Generated new unique ID: ${uniqueId}`);

    // Save the newly generated ID in settings
    // ManagerSettings (this.homey.settings) persists data locally.
    this.homey.settings.set('installUniqueId', uniqueId);

    return uniqueId;
  }


  _registerAlexaListener() {
    this.echoConnect.on('deviceActivity', async (activityData) => {
      this.log('[registerAlexaListener] deviceActivity listener - activityData:', activityData);

      if (!this.alexaCalledToken) {
        this.log('[registerAlexaListener] alexaCalledToken not available');
        return;
      }

      if (!activityData?.deviceSerial) {
        this.log('[registerAlexaListener] deviceSerial not found in activityData');
        return;
      }

      // Set the token value with the device serial number
      this.alexaCalledToken.setValue(activityData.deviceSerial)
        .then(() => {
          this.log('[registerAlexaListener] Token value set successfully for deviceSerial:', activityData.deviceSerial);
        })
        .catch((error) => {
          this.error('[registerAlexaListener] Error setting token value:', error);
        });

      // Get the device by serial number
      const devices = this.homey.drivers.getDriver('echo').getDevices();
      const device = devices.find(d => d.getData().id === activityData.deviceSerial);
      if (!device) return; // If not found, exit

      // Activate the Device Trigger Card
      const echoActivityTrigger = this.homey.flow.getDeviceTriggerCard('echo-activity');
      await echoActivityTrigger.trigger(device, {
        command: activityData.command || '',
        response: activityData.response || '',
        domain: activityData.domain || '',
        intent: activityData.intent || ''
      });
    });

    this.echoConnect.on('pushDisconnected', (willReconnect, reason) => {
      this.log('[registerAlexaListener] pushDisconnected listener - willReconnect:', willReconnect);

      if (!willReconnect) {
        const devices = this.homey.drivers.getDriver('echo').getDevices();

        devices.forEach((device, index) => {
          this.log('App - pushDisconnected listener - Try to disable', device.getName());

          device.setUnavailable().catch(this.error);
        });
      }
    });

    this.echoConnect.on('alexaConnected', async (echoDevices) => {
      this.log('[registerAlexaListener] alexaConnected listener - Initialization completed - devices found:', echoDevices.length);

      // Enable all devices when Alexa is successfully connected
      this.disableAllDevices = false;

      const isPushConnected = this.echoConnect.isPushConnected();
      this.log('[registerAlexaListener] alexaConnected listener - isPushConnected: ', isPushConnected);

      if (isPushConnected === false) {
        this.log('[registerAlexaListener] alexaConnected listener - initPushMessage called!')
        this.echoConnect.initPushMessage();
      }



      // Execute callback if it has been set
      if (this.alexaConnectedCallback) {
        this.alexaConnectedCallback(echoDevices);
      }
    });

    this.echoConnect.on('alexaDisconnected', async () => {
      this.log('[registerAlexaListener] alexaDisconnected listener');

      this.homey.notifications.createNotification({
        excerpt: this.homey.__("error.alexaDisconnected"),
      }).catch(this.error);

      const alexaDisconnectTrigger = this.homey.flow.getTriggerCard('alexa-disconnect');
      await alexaDisconnectTrigger.trigger();
    });

    this.echoConnect.on('cookieGenerated', (newLogIn, cookieData) => {
      this.log('[registerAlexaListener] cookieGenerated listener - saving new cookie on settings');

      this.homey.settings.set('cookie', cookieData);
    });
  }

  async _syncAllDevices(forceUnavailable = false, unavailableMessage = null) {
    try {
      const devices = this.homey.drivers.getDriver('echo').getDevices();

      for (const device of devices) {
        try {
          if (forceUnavailable) {
            // Force all devices as unavailable (e.g. authentication issues)
            this.log(`[syncAllDevices] Forcing device ${device.getName()} unavailable: ${unavailableMessage}`);
            await device.setUnavailable(unavailableMessage).catch(this.error);
            //await device.setStoreValue('lastIsOnline', false).catch(this.error);
            continue;
          }

          // Check the actual status of the device
          const serial = device.getData().id;
          const prevOnline = device.getStoreValue('lastIsOnline');
          const isOnline = await this.echoConnect.isOnLine(serial);
          const deviceAvailable = device.getAvailable();

          this.log(`[syncAllDevices] Checking device ${device.getName()} - available: ${deviceAvailable} - lastIsOnline: ${prevOnline} - isOnline: ${isOnline}`);

          if (prevOnline === undefined) {
            // First synchronization: set status without trigger
            if (isOnline) {
              this.log(`[syncAllDevices] Device ${device.getName()} is online.`);
              await device.setAvailable().catch(this.error);
            } else {
              this.log(`[syncAllDevices] Device ${device.getName()} is offline.`);
              await device.setUnavailable(this.homey.__("error.offline")).catch(this.error);
            }
          } else if (prevOnline !== isOnline) {
            // State change: update and activate triggers
            if (isOnline) {
              this.log(`[syncAllDevices] Device ${device.getName()} changed to online.`);
              await device.setAvailable().catch(this.error);
              const onlineStateTrigger = device.homey.flow.getDeviceTriggerCard('state-online');
              await onlineStateTrigger.trigger(device);
            } else {
              this.log(`[syncAllDevices] Device ${device.getName()} changed to offline.`);
              await device.setUnavailable(this.homey.__("error.offline")).catch(this.error);
              const offlineStateTrigger = device.homey.flow.getDeviceTriggerCard('state-offline');
              await offlineStateTrigger.trigger(device);
            }
          } else {
            // No state change: check consistency
            if (isOnline && !deviceAvailable) {
              this.log(`[syncAllDevices] Device ${device.getName()} is online but marked as unavailable. Fixing...`);
              await device.setAvailable().catch(this.error);
            } else if (!isOnline && deviceAvailable) {
              this.log(`[syncAllDevices] Device ${device.getName()} is offline but marked as available. Fixing...`);
              await device.setUnavailable(this.homey.__("error.offline")).catch(this.error);
            }
          }

          // Save the current state
          await device.setStoreValue('lastIsOnline', isOnline).catch(this.error);
        } catch (error) {
          this.error(`[syncAllDevices] Error handling device ${device.getName()}:`, error);
        }
      }
    } catch (error) {
      this.error('[syncAllDevices] Error:', error);
    }
  }


  setAlexaConnectedCallback(callback) {
    this.alexaConnectedCallback = callback;
  }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('[onInit] MyApp has been initialized');


    const installationId = this._getInstallUniqueId();
    this.log('[onInit] Installation ID:', installationId);

    // Initialize FileLogger if enableFileLogging setting is enabled
    this.fileLogger = null;
    const enableFileLogging = this.homey.settings.get('enableFileLogging') === true;
    if (enableFileLogging) {
      this.fileLogger = new FileLogger(this.homey, { clearOnStart: false });
      this.log('[onInit] FileLogger initialized - logging to /userdata/echo_debug.log');
    }

    this.echoConnect = new EchoConnect(
      EchoApp.DEBUG_MODE, 
      installationId, 
      this.fileLogger
    );

    this.alexaCalledToken = null;
    this._registerAlexaListener();

    const cookieData = this.homey.settings.get('cookie');
    let amazonPage = this.homey.settings.get('amazonPage');
    if (amazonPage === null || amazonPage === undefined || amazonPage === '') {
      amazonPage = 'amazon.de';
      this.homey.settings.set('amazonPage', amazonPage);
    }

    this.disableAllDevices = false;

    // Create a TaskScheduler instance
    this.scheduler = new TaskScheduler(
      this.homey,                     // Pass the Homey object to the TaskScheduler to use homey.setTimeout() and homey.clearTimeout()
      async () => {
        this.log("[onInit] Scheduler: Task started");

        try {
          const isConnected = await this.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

          if (isConnected) {
            this.log('[onInit] Scheduler: Alexa is connected');
            // Test - call initPushMessage every time even if already connected
            this.echoConnect.initPushMessage();

            await this._syncAllDevices();
          } else {
            this.error('[onInit] Scheduler: Alexa is not connected');
            await this._syncAllDevices(true, this.homey.__("error.authenticationIssues"));
          }
        } catch (error) {
          switch (error?.code) {
            case 'ERROR_INIT':
            case 'ERROR_PUSH':
            case 'ERROR_AUTHENTICATION':
              this.error(`[onInit] Scheduler: Authentication - ${error?.message}`);
              await this._syncAllDevices(true, this.homey.__("error.authenticationIssues"));
              break;

            default:
              this.error('[onInit] Scheduler: Generic Error:', error);
              await this._syncAllDevices(true, this.homey.__("error.generic"));
              break;
          }
        }

        this.log("[onInit] Scheduler: Task finished.");
      },                              // Define an asynchronous task
      EchoApp.SCHEDULER_INTERVAL,     // Set scheduler interval (4 hours)
      EchoApp.DEBUG_MODE,             // Enable/Disable logging
      this.fileLogger);               // Pass FileLogger instance (null if FILE_LOG_MODE is false)

    // Start the scheduler
    this.scheduler.start();



    // Add the ActionCard speak-to-serial
    this.speakToSerialActionCard = this.homey.flow.getActionCard("speak-to-serial");
    this.speakToSerialActionCard.registerRunListener(async (args) => {
      this.log(`[onInit] speakToSerialActionCard: ${JSON.stringify(args, null, 2)}`);

      const serialNumber = args['serial-number'];
      const message = args.message;
      const speakType = args['type-speak']; // 'speak', 'announce', or 'whisper'

      this.log(`[onInit] speakToSerialActionCard - Device: ${serialNumber}, Type: ${speakType}, Message: ${message}`);

      try {
        await this.echoConnect.speakEcho(serialNumber, message, speakType);
        this.log('[onInit] Speak command sent successfully');
      } catch (error) {
        this.error('[onInit] Error sending speak command:', error);

        // Switch based on error.code for specific localized messages
        switch (error?.code) {
          case 'INVALID_SERIAL':
            throw new Error(this.homey.__("error.invalidSerial"));

          case 'TEXT_TOO_LONG':
            throw new Error(this.homey.__("error.textTooLong"));

          case 'INVALID_MESSAGE':
            throw new Error(this.homey.__("error.invalidMessage"));

          case 'ERROR_SPEAK':
            throw new Error(this.homey.__("error.speakCommand"));

          default:
            // Generic error with description
            const errorDescription = error?.message || 'Unknown error';
            throw new Error(`${this.homey.__("error.generic")}: ${errorDescription}`);
        }
      }
    });

    this.log('[onInit] isCookieEmptyOrNull:', this.echoConnect.isCookieEmptyOrNull(cookieData));

    try {
      this.alexaCalledToken = await this.homey.flow.createToken("alexa_called_token", {
        type: "string",
        title: "Alexa called by",
      });

      this.log('[onInit] AlexaCalledToken created successfully');

      const isConnected = await this.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

      if (isConnected) {
        this.log('[onInit] Alexa is connected');
        this.disableAllDevices = false;
      } else {
        this.error('[onInit] Alexa is not connected');
        this.disableAllDevices = true;
      }
    } catch (error) {
      switch (error?.code) {
        case 'ERROR_INIT':
        case 'ERROR_PUSH':
        case 'ERROR_AUTHENTICATION':
          this.error(`[onInit] Authentication - ${error?.message}`);
          this.disableAllDevices = true;
          throw new Error(this.homey.__("error.authenticationIssues"));

        default:
          this.error('[onInit] Generic Error:', error);
          this.disableAllDevices = true;
          throw new Error(this.homey.__("error.generic"));
      }
    }
  }

  async onUninit() {
    this.log('App - onUninit - onUninit has been called');

    if (this.scheduler) {
      this.scheduler.stop();
    }
  }
}

module.exports = EchoApp;
