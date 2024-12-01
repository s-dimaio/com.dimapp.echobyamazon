'use strict';

const Homey = require('homey');
const EchoConnect = require('./lib/EchoConnect')


class MyApp extends Homey.App {


  setAppListener() {
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

    this.echoConnect.on('alexaConnected', (devArray) => {
      this.log('App - alexaConnected listener - Inizializzazione completata - dispositivi trovati:', devArray.length);

      const isPushConnected = this.echoConnect.isPushConnected();
      this.log('App - alexaConnected listener - isPushConnected: ', isPushConnected);

      if (isPushConnected === false) {
        this.log('App - alexaConnected listener - initPushMessage called!')
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

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('App - onInit - MyApp has been initialized');

    this.echoConnect = new EchoConnect();
    this.setAppListener();


    const cookieData = this.homey.settings.get('cookie');

    let amazonPage = this.homey.settings.get('amazonPage');
    if (amazonPage === null || amazonPage === undefined || amazonPage === '') {
      amazonPage = 'amazon.de';
      this.homey.settings.set('amazonPage', amazonPage);
    }

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
