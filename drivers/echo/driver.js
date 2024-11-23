'use strict';

const Homey = require('homey');

class MyDriver extends Homey.Driver {

  // Crea un Json con il formato accettato da Homey per i devices
  formatDevicesForHomey(arrayDevices) {
    if (!arrayDevices) {
      console.error('arrayDevices non è definito');
      return [];
    }

          // await this.setSettings({
      //   // only provide keys for the settings you want to change
      //   deviceFamily: "Jane Doe",
      //   deviceType: "Jane Doe",
      //   serialNumber: "Jane Doe"
      // });

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

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('onInit - MyDriver has been initialized');

    const speakActionCard = this.homey.flow.getActionCard('echo-speak');
    speakActionCard.registerRunListener(async (args) => {
      //const {message} = args;
      const message = args.message;

      this.log(`flow message: ${message}`);
      //this.log(`flow message: ${message} - id: ${args.device.getData().id}`);

      await args.device.speakEcho(message);
    });

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
