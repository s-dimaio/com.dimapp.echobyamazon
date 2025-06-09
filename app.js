'use strict';

const Homey = require('homey');
const { EchoConnect } = require('./lib/EchoConnect')
const { TaskScheduler } = require('./lib/TaskScheduler');


class EchoApp extends Homey.App {

  // Configuration constants
  static SCHEDULER_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours



  _registerAlexaListener() {
    this.echoConnect.on('alexaCalled', (alexaCallData) => {
      this.log('[registerAlexaListener] alexaCalled listener - alexaCallData:', alexaCallData);

      if (!this.alexaCalledToken) {
        this.log('[registerAlexaListener] alexaCalledToken not available');
        return;
      }

      if (!alexaCallData?.deviceSerial) {
        this.log('[registerAlexaListener] deviceSerial not found in alexaCallData');
        return;
      }

      // Set the token value with the device serial number
      this.alexaCalledToken.setValue(alexaCallData.deviceSerial).catch((error) => {
        this.error('[registerAlexaListener] Error setting token value:', error);
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

  _disableAllDevices(msg) {
    try {
      const devices = this.homey.drivers.getDriver('echo').getDevices();

      devices.forEach((device, index) => {
        this.log('[disableAllDevices] Try to disable', device.getName());

        device.setUnavailable(msg).catch(this.error);
      });
    } catch (error) {
      this.error('[disableAllDevices] Error:', error);
    }
  }

  _enableAllDevices() {
    try {
      const devices = this.homey.drivers.getDriver('echo').getDevices();

      devices.forEach((device, index) => {
        this.log('[enableAllDevices] Try to enable', device.getName());

        device.setAvailable().catch(this.error);
      });
    } catch (error) {
      this.error('[enableAllDevices] Error:', error);
    }
  }

  _checkStatusDevices() {
    try {
      const devices = this.homey.drivers.getDriver('echo').getDevices();

      devices.forEach(async (device, index) => {
        const isOnline = await this.echoConnect.isOnLine(device.getData().id);
        if (isOnline) {
          this.log(`[checkStatusDevices] Device ${device.getName()} is online.`);
          device.setAvailable().catch(this.error);
        } else {
          this.error(`[checkStatusDevices] Device ${device.getName()} is offline.`);
          device.setUnavailable(this.homey.__("error.offline")).catch(this.error);
        }
      });
    } catch (error) {
      this.error('[checkStatudDevices] Error:', error);
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


    this.echoConnect = new EchoConnect(false);

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
            this._enableAllDevices();
            this._checkStatusDevices();
          } else {
            this.error('[onInit] Scheduler: Alexa is not connected');
            this._disableAllDevices(this.homey.__("error.authenticationIssues"));
          }
        } catch (error) {
          switch (error?.code) {
            case 'ERROR_INIT':
            case 'ERROR_PUSH':
            case 'ERROR_AUTHENTICATION':
              this.error(`[onInit] Scheduler: Authentication - ${error?.message}`);
              this._disableAllDevices(this.homey.__("error.authenticationIssues"));
              break;

            default:
              this.error('[onInit] Scheduler: Generic Error:', error);
              this._disableAllDevices(this.homey.__("error.generic"));
              break;
          }
        }

        this.log("[onInit] Scheduler: Task finished.");
      },                              // Define an asynchronous task
      EchoApp.SCHEDULER_INTERVAL,     // Set scheduler interval (4 hours)
      false);                         // Enable/Disable logging

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

          case 'ERROR_SPEAK':
            throw new Error(this.homey.__("error.speakCommand"));

          default:
            throw new Error(this.homey.__("error.generic"));
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
