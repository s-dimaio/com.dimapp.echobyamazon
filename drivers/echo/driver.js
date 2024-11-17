'use strict';

const Homey = require('homey');

class MyDriver extends Homey.Driver {

  // Crea un Json con il formato accettato da Homey per i devices
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

          // Set AlexaConnected callback to show devies list
          this.homey.app.setAlexaConnectedCallback(() => {
            this.log('device id ' + device.getData().id + ' - repaired')

            device.setDeviceListener();
            device.setAvailable().catch(this.error);

            session.done()
          });

          await this.homey.app.echoConnect.initAlexa({
            cookieData: cookieData,
            amazonPage: amazonPage,
            closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
          });
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
      // Cleanup
    });
  }


  onPair(session) {
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

          // Set AlexaConnected callback to show devies list
          this.homey.app.setAlexaConnectedCallback(() => {
            //Show devices list
            session.showView('list_my_devices');
          });

          this.log('isPushConnected:', this.homey.app.echoConnect.isPushConnected());

          await this.homey.app.echoConnect.initAlexa({
            cookieData: cookieData, 
            amazonPage: amazonPage,
            closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
          });
        } catch (err) {
          this.error('Error initializing Alexa: ', err);

          await session.showView('alexa_login');
        }
      }
    });
  }
}

module.exports = MyDriver;
