'use strict';

const Homey = require('homey');

class MyDriver extends Homey.Driver {

  // Create a Json with the format accepted by Homey for devices
  formatDevicesForHomey(arrayDevices) {
    if (!arrayDevices) {
      console.error('arrayDevices non è definito');
      return [];
    }

    return arrayDevices.map(device => ({
      name: device.name,
      data: {
        id: device.serial
      },
      settings: {
        deviceFamily: device.family,
        deviceType: device.type,
        serialNumber: device.serial
      },
      icon: device.getIcon()
    }));
  }

  async speakEcho(id, text, type = 'speak') {
    this.log(`Driver - speakEcho - id: ${id} - message: ${text} - type: ${type} - isPushConnected: ${this.homey.app.echoConnect.isPushConnected()}`);

    if (this.homey.app.echoConnect.isPushConnected()) {
      this.homey.app.echoConnect.speakEcho(id, text, type);

    } else {
      this.setUnavailable().catch(this.error);

    }
  }

  async sendAlexaCommand(id, command) {
    this.log(`Driver - sendAlexaCommand - id: ${id} with message: ${command} - isPushConnected: ${this.homey.app.echoConnect.isPushConnected()}`);

    if (this.homey.app.echoConnect.isPushConnected()) {
      this.homey.app.echoConnect.executeAlexaCommand(id, command);

    } else {
      this.setUnavailable().catch(this.error);

    }
  }

  setEchoFlowActionCard() {
    // Set 'echo-speak' flow card
    const speakActionCard = this.homey.flow.getActionCard('echo-speak');
    speakActionCard.registerRunListener(async (args) => {
      //throw new Error ('Test Error!! oops');

      const message = args.message;

      this.log(`Driver - setEchoFlowActionCard - echo-speak flow message: ${message}`);

      try {
        // ** It might be appropriate to use 'await'? **//
        this.speakEcho(args.device.getData().id, message)
      } catch (err) {
        throw new Error(err);
      }
    });

    // Set 'echo-announcement' flow card
    const announcementActionCard = this.homey.flow.getActionCard('echo-announcement');
    announcementActionCard.registerRunListener(async (args) => {
      const announcement = args.announcement;

      this.log(`Driver - setEchoFlowActionCard - echo-announcement flow message: ${announcement}`);

      // ** It might be appropriate to use 'await'? **//
      this.speakEcho(args.device.getData().id, announcement, 'announce')
    });

    // Set 'echo-whisper' flow card
    const whisperActionCard = this.homey.flow.getActionCard('echo-whisper');
    whisperActionCard.registerRunListener(async (args) => {
      const message = args.message;

      this.log(`Driver - setEchoFlowActionCard - echo-whisper flow message: ${message}`);

      // ** It might be appropriate to use 'await'? **//
      this.speakEcho(args.device.getData().id, message, 'whisper');
    });

    // Set 'alexa-command' flow card
    const alexaCommandActionCard = this.homey.flow.getActionCard('alexa-command');
    alexaCommandActionCard.registerRunListener(async (args) => {
      const command = args.command;

      this.log(`Driver - setEchoFlowActionCard - alexa-command flow message: ${command}`);

      // ** It might be appropriate to use 'await'? **//
      this.sendAlexaCommand(args.device.getData().id, command);
    });
  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('onInit - MyDriver has been initialized');

    this.setEchoFlowActionCard();
  }

  async onUninit() {
    this.log('Driver - onUninit has been called');

  }

  onRepair(session, device) {
    // Argument session is a PairSocket, similar to Driver.onPair
    // Argument device is a Homey.Device that's being repaired

    // Manages the AmazonPage radio button changes
    session.setHandler("amazonPage", async (amazonPage) => {
      this.log('amazonPage called: ', amazonPage);
      this.homey.settings.set('amazonPage', amazonPage);

      try {
        // Set AlexaConnected Callback
        this.homey.app.setAlexaConnectedCallback(() => {
          this.log('device id ' + device.getData().id + ' - repaired')

          device.setDeviceListener();
          device.setAvailable().catch(this.error);

          session.done()
        });

        await this.homey.app.echoConnect.initAlexa({
          cookieData: '',
          amazonPage: amazonPage,
          foceToken: true,
          closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
        });

      } catch (err) {
        this.error('Driver amazonPage - Error initializing Alexa: ', err);

        await session.emit("serverReady");
      }
    });

    session.setHandler('showView', async (view) => {
      this.log('onRepair - showView called: ', view);

      if (view === "alexa_repair_login") {
        await session.emit("dataLogin", {
          loginUrl: this.homey.app.echoConnect.loginUrl,
          amazonPage: this.homey.settings.get('amazonPage')
        });
      }

      if (view === 'opening_loading') {
        try {
          const cookieData = this.homey.settings.get('cookie');
          const amazonPage = this.homey.settings.get('amazonPage');

          try {
            const isAuthenticated = await this.homey.app.echoConnect.isAuthenticated();
            if (isAuthenticated) {
              this.log('You are already authenticated on Alexa servers');

              const isPushConnected = this.homey.app.echoConnect.isPushConnected();

              if (isPushConnected === false) {
                this.log('initPushMessage called!')
                this.homey.app.echoConnect.initPushMessage()
              }

              device.setAvailable().catch(this.error);
              session.done();

            } else {
              this.log('You need to re-authenticate.');

              // Set AlexaConnected callback to show devices list
              this.homey.app.setAlexaConnectedCallback(() => {
                this.log('device id ' + device.getData().id + ' - repaired');
                //device.setDeviceListener();
                device.setAvailable().catch(this.error);
                session.done();
              });

              await this.homey.app.echoConnect.initAlexa({
                cookieData: cookieData,
                amazonPage: amazonPage,
                closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
              });
            }
          } catch (error) {
            this.error('An error occurred:', error);
            await session.showView('alexa_repair_login');
          }

        } catch (err) {
          this.error('Error initializing Alexa: ', err);
          await session.showView('alexa_repair_login');
        }
      }
    });

    session.setHandler("my_event", (data) => {
      // Your code
    });

    session.setHandler("disconnect", () => {
      this.log('onRepair - disconnect called')

      device.setDeviceVolume(device.getData().id);
    });
  }


  onPair(session) {

    // Manages the AmazonPage radio button changes
    session.setHandler("amazonPage", async (amazonPage) => {
      this.log('amazonPage called: ', amazonPage);
      this.homey.settings.set('amazonPage', amazonPage);

      try {
        // Set AlexaConnected Callback
        this.homey.app.setAlexaConnectedCallback(() => {
          //Show devices list
          session.showView('list_my_devices');
        });

        await this.homey.app.echoConnect.initAlexa({
          cookieData: '',
          amazonPage: amazonPage,
          forceToken: true,
          closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
        });

      } catch (err) {
        this.error('Driver amazonPage - Error initializing Alexa: ', err);

        await session.emit("serverReady");
      }
    });

    session.setHandler("list_devices", async () => {
      this.log('onPair - ListDevices called');

      try {
        const devices = this.formatDevicesForHomey(this.homey.app.echoConnect.arrayDevices);
        this.log('Devices formatati:', devices);

        return devices;
      } catch (error) {
        this.error('Errore durante il recupero dei dispositivi:', error);

        return [];
      }
    });

    session.setHandler('showView', async (view) => {
      this.log('onPair - showView called: ', view);

      if (view === "alexa_login") {
        await session.emit("dataLogin", {
          loginUrl: this.homey.app.echoConnect.loginUrl,
          amazonPage: this.homey.settings.get('amazonPage')
        });
      }


      if (view === 'opening_loading') {
        try {
          const cookieData = this.homey.settings.get('cookie');
          const amazonPage = this.homey.settings.get('amazonPage');

          try {
            const isAuthenticated = await this.homey.app.echoConnect.isAuthenticated();
            if (isAuthenticated) {
              this.log('You are already authenticated on Alexa servers');

              const isPushConnected = this.homey.app.echoConnect.isPushConnected();
              this.log('isPushConnected: ', isPushConnected);

              if (isPushConnected === false) {
                this.log('initPushMessage called!')
                this.homey.app.echoConnect.initPushMessage()
              }

              //Show devices list
              session.showView('list_my_devices');
            } else {
              this.log('You need to re-authenticate.');

              // Set AlexaConnected callback to show devies list
              this.homey.app.setAlexaConnectedCallback(() => {
                //Show devices list
                session.showView('list_my_devices');
              });

              await this.homey.app.echoConnect.initAlexa({
                cookieData: cookieData,
                amazonPage: amazonPage,
                closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
              });
            }
          } catch (error) {
            this.error('An error occurred:', error);
            await session.showView('alexa_login');
          }

        } catch (err) {
          this.error('Error initializing Alexa: ', err);
          await session.showView('alexa_login');
        }
      }
    });
  }
}

module.exports = MyDriver;
