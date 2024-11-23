'use strict';

const Homey = require('homey');
let isPushMessage = true;


class MyDevice extends Homey.Device {

  setDeviceListener() {
    // Aggiungi un listener per l'evento 'volumeChanged'
    this.homey.app.echoConnect.on('volumeChanged', (serial, newVolume) => {
      if (this.getData().id === serial) {
        if (isPushMessage) {
          this.log(`volumeChanged called - id: ${serial} - volume: ${newVolume}`)

          this.setCapabilityValue('volume_set', (newVolume / 100)).catch(this.error);
        } else {
          isPushMessage = true;
        }
      }
    });

    this.registerCapabilityListener("volume_set", async (value) => {
      this.log(`registerCapabilityListener - aggiorno il volume - id: ${this.getData().id} - volume: ${value * 100} - isPushConnected: ${this.homey.app.echoConnect.isPushConnected()}`)

      if (this.homey.app.echoConnect.isPushConnected()) {
        isPushMessage = false;
        await this.homey.app.echoConnect.setVolumeDevice(this.getData().id, (value * 100));

      } else {
        this.setUnavailable().catch(this.error);

      }
    });
  }

  async speakEcho(text) {
    this.log(`speak echo id: ${this.getData().id} with message: ${text} - isPushConnected: ${this.homey.app.echoConnect.isPushConnected()}`);

    if (this.homey.app.echoConnect.isPushConnected()) {
      this.homey.app.echoConnect.speakEcho(this.getData().id, text)

    } else {
      this.setUnavailable().catch(this.error);

    }
  }

  setDeviceVolume(id) {
    this.homey.app.echoConnect.getVolumeDevice(id)
      .then(volume => {
        this.log(`getVolumeDevice - id: ${id} - volume: ${volume}`)

        this.setCapabilityValue('volume_set', (volume / 100)).catch(this.error);
      })
      .catch(error => this.error(error.message));
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('Device ' + this.getName() + ' (' + this.getData().id + ') has been initialized - isPushConnected: ' + this.homey.app.echoConnect.isPushConnected());

    const cookieData = this.homey.settings.get('cookie');
    this.log('Device - onInit - isCookieEmptyOrNull:', this.homey.app.echoConnect.isCookieEmptyOrNull(cookieData));

    if (!this.homey.app.echoConnect.isCookieEmptyOrNull(cookieData)) {
      //Register device listener
      this.setDeviceListener();

      //Set the initial volume of the device
      this.setDeviceVolume(this.getData().id);

    } else {
      this.setUnavailable().catch(this.error);

    }
  }

  async onUninit() {
    this.log('Device - onUninit has been called');

  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('MyDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('MyDevice settings where changed');

  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('MyDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');
  }

}

module.exports = MyDevice;
