'use strict';

const Homey = require('homey');
const { EchoConnect } = require('./lib/EchoConnect')
let playGroupActionCard;


class MyApp extends Homey.App {



  registerAlexaListener() {
    this.echoConnect.on('pushDisconnected', (willReconnect, reason) => {
      this.log('App - pushDisconnected listener - willReconnect:', willReconnect);

      if (!willReconnect) {
        const devices = this.homey.drivers.getDriver('echo').getDevices();

        devices.forEach((device, index) => {
          this.log('App - pushDisconnected listener - Try to disable', device.getName());

          device.setUnavailable().catch(this.error);
        });
      }
    });

    this.echoConnect.on('alexaConnected', async (devArray) => {
      this.log('App - alexaConnected listener - Inizializzazione completata - dispositivi trovati:', devArray.length);

      const isPushConnected = this.echoConnect.isPushConnected();
      this.log('App - alexaConnected listener - isPushConnected: ', isPushConnected);

      if (isPushConnected === false) {
        this.log('App - alexaConnected listener - initPushMessage called!')
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

            this.log('echoGroupFlow:', JSON.stringify(results, null, 2));

            // filter based on the query
            return results.filter((result) => {
              return result.name.toLowerCase().includes(query.toLowerCase());
            });

          } catch (error) {
            console.error("Error getting audio groups:", error);
            return [];
          }
        }
      );



      // Execute callback if it has been set
      if (this.alexaConnectedCallback) {
        this.alexaConnectedCallback(devArray);
      }
    });

    this.echoConnect.on('cookieGenerated', (newLogIn, cookieData) => {
      this.log('App - cookieGenerated listener - saving new cookie on settings');

      //this.homey.settings.set('cookie', JSON.stringify(cookieData));
      this.homey.settings.set('cookie', cookieData);
    });
  }

  setAlexaConnectedCallback(callback) {
    this.alexaConnectedCallback = callback;
  }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('App - onInit - MyApp has been initialized');

    this.echoConnect = new EchoConnect(true);
    this.registerAlexaListener();


    const cookieData = this.homey.settings.get('cookie');

    let amazonPage = this.homey.settings.get('amazonPage');
    if (amazonPage === null || amazonPage === undefined || amazonPage === '') {
      amazonPage = 'amazon.de';
      this.homey.settings.set('amazonPage', amazonPage);
    }

    playGroupActionCard = this.homey.flow.getActionCard("play-to-echo-group");
    playGroupActionCard.registerRunListener(async (args) => {
      //throw new Error ('Test Error!! oops');

      const id = args.group.id;
      const name = args.group.name;

      this.log(`App - setEchoFlowActionCard - echo-speak flow message: ${id}`);

      try {
        await this.homey.drivers.getDriver('echo').executeEchoAction(id, 'ciao', 'speak');
        this.log('Routine command sent successfully');
      } catch (error) {
        this.error('Error calling routine:', error);
      }
    });



    this.log('App - onInit - isCookieEmptyOrNull:', this.homey.app.echoConnect.isCookieEmptyOrNull(cookieData));

    if (!this.homey.app.echoConnect.isCookieEmptyOrNull(cookieData)) {
      try {
        const isAuthenticated = await this.homey.app.echoConnect.isAuthenticated();
        if (isAuthenticated) {
          this.log('App - onInit - You are already authenticated on Alexa servers');

          const isPushConnected = this.echoConnect.isPushConnected();
          this.log('App - onInit - isPushConnected: ', isPushConnected);

          if (isPushConnected === false) {
            this.log('App - onInit - initPushMessage called!')
            this.echoConnect.initPushMessage()
          }

          //const echoGroup = this.echoConnect.getAudioGroupsList();
          //this.log('echoGroup:', JSON.stringify(echoGroup, null, 2));

        } else {
          this.log('App - onInit - You need to re-authenticate.');

          await this.homey.app.echoConnect.initAlexa({
            cookieData: cookieData,
            amazonPage: amazonPage,
            closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
          });
        }
      } catch (error) {
        this.error('App - onInit - Error during initialization:', error);
      }
    }
  }

  async onUninit() {
    this.log('App - onUninit - onUninit has been called');

  }
}

module.exports = MyApp;
