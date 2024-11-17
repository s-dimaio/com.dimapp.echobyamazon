'use strict';

const Homey = require('homey');
const EchoConnect = require('./lib/EchoConnect')


class MyApp extends Homey.App {


  setAppListener() {
    this.echoConnect.on('pushDisconnected', (willReconnect, reason) => {
      this.log('App - pushDisconnected listener');

      // Execute callback if it has been set
      if (this.pushDisconnectedCallback) {
        this.pushDisconnectedCallback(willReconnect);
      }
    });

    this.echoConnect.on('alexaConnected', (devArray) => {
      this.log('App - alexaConnected listener - Inizializzazione completata - dispositivi trovati:', devArray.length);

      const isPushConnected = this.echoConnect.isPushConnected();
      this.log('isPushConnected: ', isPushConnected);

      if (isPushConnected === false) {
        this.log('initPushMessage called!')
        this.echoConnect.initPushMessage()
      }

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

  setPushDisconnectedCallback(callback) {
    this.pushDisconnectedCallback = callback;
  }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');

    this.echoConnect = new EchoConnect();
    this.setAppListener();

    this.homey.settings.set('amazonPage', 'amazon.com');

    //******** resetto il cookie setting per test ***********
    //this.homey.settings.unset('cookie');
    //this.mockCookie();
    //*** */


    /*
Se non funziona riportare in driver.js
//*** */
    const cookieData = this.homey.settings.get('cookie');
    const amazonPage = this.homey.settings.get('amazonPage');

    if (!this.homey.app.echoConnect.isCookieEmptyOrNull(cookieData)) {
      try {
        await this.homey.app.echoConnect.initAlexa({
          cookieData: cookieData,
          amazonPage: amazonPage,
          closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
        });
      } catch (err) {
        this.error('onInit - Errore durante l\'inizializzazione:', err);
      }
    }
    //*** */


  }

  async onUninit() {
    this.log('App - onUninit has been called');

  }
}

module.exports = MyApp;
