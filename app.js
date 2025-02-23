'use strict';

const Homey = require('homey');
const { EchoConnect } = require('./lib/EchoConnect')
const { TaskScheduler } = require('./lib/TaskScheduler');
let playGroupActionCard;


class MyApp extends Homey.App {



  _registerAlexaListener() {
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
      this.log('[registerAlexaListener] alexaConnected listener - Inizializzazione completata - dispositivi trovati:', echoDevices.length);

      const isPushConnected = this.echoConnect.isPushConnected();
      this.log('[registerAlexaListener] alexaConnected listener - isPushConnected: ', isPushConnected);

      if (isPushConnected === false) {
        this.log('[registerAlexaListener] alexaConnected listener - initPushMessage called!')
        this.echoConnect.initPushMessage();
      }

      playGroupActionCard.registerArgumentAutocompleteListener(
        "group",
        async (query, args) => {
          try {
            const echoGroup = await this.echoConnect.getAudioGroupsList();
            const results = echoGroup.map(item => ({
              name: item.name,
              id: item.id
            }));

            this.log('[registerAlexaListener] playGroupActionCard:', JSON.stringify(results, null, 2));

            // filter based on the query
            return results.filter((result) => {
              return result.name.toLowerCase().includes(query.toLowerCase());
            });

          } catch (error) {
            console.error("[registerAlexaListener] Error getting audio groups:", error);
            return [];
          }
        }
      );

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

      //this.homey.settings.set('cookie', JSON.stringify(cookieData));
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

  _checkStatudDevices() {
    try {
      const devices = this.homey.drivers.getDriver('echo').getDevices();

      devices.forEach(async (device, index) => {
        const isOnline = await this.echoConnect.isOnLine(device.getData().id);
        if (isOnline) {
          this.log(`[checkStatudDevices] Device ${device.getName()} is online.`);
          device.setAvailable().catch(this.error);
        } else {
          this.error(`[checkStatudDevices] Device ${device.getName()} is offline.`);
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

    this._registerAlexaListener();

    const cookieData = this.homey.settings.get('cookie');
    let amazonPage = this.homey.settings.get('amazonPage');
    if (amazonPage === null || amazonPage === undefined || amazonPage === '') {
      amazonPage = 'amazon.de';
      this.homey.settings.set('amazonPage', amazonPage);
    }

    this.disableAllDevices = false;

    // Create a TaskScheduler instance to run a task every 5 seconds
    this.scheduler = new TaskScheduler(
      this.homey,           // Pass the Homey object to the TaskScheduler to use homey.setTimeout() and homey.clearTimeout()
      async () => {
        this.log("[onInit] Scheduler: Task started");

        try {
          const isConnected = await this.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

          if (isConnected) {
            this.log('[onInit] Scheduler: Alexa is connected');
            this._enableAllDevices();
            this._checkStatudDevices();
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
          }
        }

        this.log("[onInit] Scheduler: Task finished.");
      },                      // Define an asynchronous task
      4 * 60 * 60 * 1000,     // Set scheduler interval (default: 1 hour) - 1 * 60 * 60 * 1000
      false);                 // Enable/Disable logging

    // Start the scheduler
    this.scheduler.start();


    playGroupActionCard = this.homey.flow.getActionCard("play-to-echo-group");
    playGroupActionCard.registerRunListener(async (args) => {
      //throw new Error ('Test Error!! oops');

      this.log(`[onInit] setEchoFlowActionCard: ${JSON.stringify(args, null, 2)}`);

      const id = args.group.id;
      const name = args.group.name;
      const command = args.command;

      this.log(`[onInit] setEchoFlowActionCard - echo-speak flow message: ${command}`);

      try {
        //await this.homey.drivers.getDriver('echo').executeEchoAction(id, 'ciao', 'announce');
        // Try to change the playback to play or pause
        await this.echoConnect.changePlayback(id, command);

        this.log('[onInit] Routine command sent successfully');
      } catch (error) {
        this.error('[onInit] Error calling routine:', error);
      }
    });

    this.log('[onInit] isCookieEmptyOrNull:', this.echoConnect.isCookieEmptyOrNull(cookieData));

    try {
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
          break;

        default:
          this.error('[onInit] Generic Error:', error);
          this.disableAllDevices = true;
      }
    }


    // if (!this.echoConnect.isCookieEmptyOrNull(cookieData)) {
    //   try {
    //     const isAuthenticated = await this.echoConnect.isAuthenticated();
    //     if (isAuthenticated) {
    //       this.log('[onInit] - You are already authenticated on Alexa servers');

    //       const isPushConnected = this.echoConnect.isPushConnected();
    //       this.log('[onInit] - isPushConnected: ', isPushConnected);

    //       if (isPushConnected === false) {
    //         this.log('[onInit] - initPushMessage called!')
    //         this.echoConnect.initPushMessage()
    //       }

    //       //const echoGroup = this.echoConnect.getAudioGroupsList();
    //       //this.log('echoGroup:', JSON.stringify(echoGroup, null, 2));

    //     } else {
    //       this.log('[onInit] - You need to re-authenticate.');

    //       await this.echoConnect.initAlexa({
    //         cookieData: cookieData,
    //         amazonPage: amazonPage,
    //         closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
    //       });
    //     }
    //   } catch (error) {
    //     this.error('[onInit] - Error during initialization:', error);
    //   }
    // }
  }

  async onUninit() {
    this.log('App - onUninit - onUninit has been called');

    if (this.scheduler) {
      this.scheduler.stop();
    }
  }
}

module.exports = MyApp;
