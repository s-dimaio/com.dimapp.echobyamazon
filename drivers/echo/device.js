'use strict';

const Homey = require('homey');
const { AlexaError } = require('../../lib/EchoConnect');

class MyDevice extends Homey.Device {

  _waitForEvent(event, timeout, errorMessage) {
    return new Promise((resolve, reject) => {
      this.homey.app.echoConnect.once(event, () => {
        this.homey.clearTimeout(timeoutId);
        resolve();
      });

      const timeoutId = this.homey.setTimeout(() => {
        reject(new AlexaError('ERROR_TIMEOUT', errorMessage || `Timeout for event ${event}`));
      }, timeout);
    });
  }

  _registerAlexaListener() {
    //Add listener for the Alexa event 'queueChanged' that manage queue changes (shuffle and loop mode)
    this.homey.app.echoConnect.on('queueChanged', async (queueDetail) => {
      this.log('Device - queueChanged:', queueDetail.deviceSerialNumber);

      if (this.getData().id === queueDetail.deviceSerialNumber) {
        if (this.wsQueueChanged) {
          this.log(`queueChanged called - id: ${queueDetail.deviceSerialNumber} - shuffle: ${queueDetail.playBackOrder} - repeat: ${queueDetail.loopMode}`)

          //Update the shuffle capabilities - value: true/false
          this.setCapabilityValue('speaker_shuffle', (queueDetail.playBackOrder === 'SHUFFLE_ALL' ? true : false)).catch(this.error);

          //Update the repeat capabilities - value: 'track'/'playlist'/'none' - 'playlist' is not supported by Echo devices
          this.setCapabilityValue('speaker_repeat', (queueDetail.loopMode === 'LOOP_QUEUE' ? 'track' : 'none')).catch(this.error);

        } else {
          this.wsQueueChanged = true;
        }
      }
    });

    //Add listener for the Alexa event 'playerChanged' that manage player changes
    this.homey.app.echoConnect.on('playerChanged', async (playerDetail) => {
      this.log('Device - playerChanged:', playerDetail.serial);

      if (this.getData().id === playerDetail.serial) {
        this.log('Device - playerChanged - mediaId:', this.getStoreValue('mediaId'));

        if (playerDetail.mediaId !== this.getStoreValue('mediaId')) {
          this.setStoreValue('mediaId', playerDetail.mediaId);

          this.log('Device - playerChanged - loading art album ' + playerDetail.track.artwork + ' in ' + this.getData().id);
          this.albumArt.setUrl(playerDetail.track.artwork);
          //await this.setAlbumArtImage(this.albumArt);
          await this.albumArt.update();

          this.setCapabilityValue('speaker_artist', playerDetail.track.artist).catch(this.error);
          this.setCapabilityValue('speaker_album', playerDetail.track.album).catch(this.error);
          this.setCapabilityValue('speaker_track', playerDetail.track.title).catch(this.error);
        }

        this.log(`Device - playerChanged - id: ${playerDetail.serial} - playing: ${playerDetail.state}`);
        this.setCapabilityValue('speaker_playing', playerDetail.state).catch(this.error);
      }
    });

    //Add listener for the Alexa event 'volumeChanged' that manage volume changes
    this.homey.app.echoConnect.on('volumeChanged', (serial, newVolume) => {
      if (this.getData().id === serial) {
        if (this.wsVolumeChanged) {
          this.log(`volumeChanged called - id: ${serial} - volume: ${newVolume}`)

          this.setCapabilityValue('volume_set', (newVolume / 100)).catch(this.error);
        } else {
          this.wsVolumeChanged = true;
        }
      }
    });
  }

  _registerHomeyListener() {
    const cookieData = this.homey.settings.get('cookie');
    const amazonPage = this.homey.settings.get('amazonPage');

    this.registerCapabilityListener("volume_set", async (value) => {
      this.log('Device - registerHomeyListener - volume_set:', value * 100);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);
        if (isConnected) {
          this.wsVolumeChanged = false;
          await this.homey.app.echoConnect.setVolumeDevice(this.getData().id, (value * 100));

          // Wait 5 sec for the volumeChanged event
          await this._waitForEvent('volumeChanged', 5000);

        } else {
          await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_TIMEOUT':
            this.error(`Timeout error with volume_set: ${error?.message}`);
            throw new Error(this.homey.__("error.volume.timeout"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication: ${error?.message}`);
            await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;
          case 'ERROR_VOLUME':
            this.error(`Error in setting volume device: ${error?.message}`);
            throw new Error(this.homey.__("error.volume.generic"));
          default:
            this.error('Error in volume_set capability:', error);
        }
      }
    });


    this.registerCapabilityListener('speaker_playing', async (value) => {
      this.log('Device - registerHomeyListener - speaker_playing:', value);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);
        if (isConnected) {
          // Try to change the playback to play or pause
          await this.homey.app.echoConnect.changePlayback(this.getData().id, value ? 'play' : 'pause');

          // Wait 5 sec for the playerChanged event
          await this._waitForEvent('playerChanged', 5000);

        } else {
          await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_TIMEOUT':
            this.error(`Timeout error with speaker_playing: ${error?.message}`);

            this.setStoreValue('mediaId', null);

            this.albumArt.setUrl(null);
            await this.albumArt.update();

            this.setCapabilityValue('speaker_artist', null).catch(this.error);
            this.setCapabilityValue('speaker_album', null).catch(this.error);
            this.setCapabilityValue('speaker_track', null).catch(this.error);
            this.setCapabilityValue('speaker_playing', false).catch(this.error);

            throw new Error(this.homey.__("error.playback.timeout"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication: ${error?.message}`);
            await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;
          case 'ERROR_NOT_SUPPORTED':
            this.error(`Error during speaker_playing: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.notSupported"));
          case 'ERROR_PLAYBACK':
            this.error(`Error during speaker_playing: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.generic"));
          default:
            this.error('Error in speaker_playing capability:', error);
        }
      }
    });

    this.registerCapabilityListener('speaker_prev', async () => {
      this.log('Device - registerHomeyListener - speaker_prev');

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);
        if (isConnected) {
          // Try to change the playback to previous track
          await this.homey.app.echoConnect.changePlayback(this.getData().id, 'previous');

          // Wait 5 sec for the playerChanged event
          await this._waitForEvent('playerChanged', 5000);

        } else {
          await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_TIMEOUT':
            this.error(`Timeout error with speaker_prev: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.timeout"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication: ${error?.message}`);
            await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;
          case 'ERROR_NOT_SUPPORTED':
            this.error(`Error during speaker_playing: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.notSupported"));
          case 'ERROR_PLAYBACK':
            this.error(`Error during speaker_prev: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.generic"));
          default:
            this.error('Error in speaker_prev capability:', error);
        }
      }
    });

    this.registerCapabilityListener('speaker_next', async () => {
      this.log('Device - registerHomeyListener - speaker_next');

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);
        if (isConnected) {
          // Try to change the playback to next track
          await this.homey.app.echoConnect.changePlayback(this.getData().id, 'next');

          // Wait 5 sec for the playerChanged event
          await this._waitForEvent('playerChanged', 5000);

        } else {
          await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_TIMEOUT':
            this.error(`Timeout error with speaker_next: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.timeout"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication: ${error?.message}`);
            await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;
          case 'ERROR_NOT_SUPPORTED':
            this.error(`Error during speaker_playing: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.notSupported"));
          case 'ERROR_PLAYBACK':
            this.error(`Error during speaker_next: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.generic"));
          default:
            this.error('Error in speaker_next capability:', error);
        }
      }
    });

    this.registerCapabilityListener('speaker_shuffle', async (value) => {
      this.log('Device - registerHomeyListener - speaker_shuffle:', value);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);
        if (isConnected) {
          this.wsQueueChanged = false;
          await this.homey.app.echoConnect.changePlayback(this.getData().id, 'shuffle', value);

          // Wait 5 sec for the queueChanged event
          await this._waitForEvent('queueChanged', 5000);

        } else {
          await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_TIMEOUT':
            this.error(`Timeout error with speaker_shuffle: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.timeout"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication: ${error?.message}`);
            await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;
          case 'ERROR_NOT_SUPPORTED':
            this.error(`Error during speaker_playing: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.notSupported"));
          case 'ERROR_PLAYBACK':
            this.error(`Error during speaker_shuffle: ${error?.message}`);
            throw new Error(this.homey.__("error.playback.generic"));
          default:
            this.error('Error in speaker_shuffle capability:', error);
        }
      }
    });

    this.registerCapabilityListener('speaker_repeat', async (value) => {
      this.log('Device - registerHomeyListener - speaker_repeat:', value, value !== 'none');

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);
        if (isConnected) {
          let repeat = value;

          if (value === 'playlist') {
            this.log('Device - registerHomeyListener - speaker_repeat - value: playlist is not supported by Echo devices');

            this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
            repeat = 'none';
          }

          this.log('Device - registerHomeyListener - repeat:', repeat);

          this.wsQueueChanged = false;
          await this.homey.app.echoConnect.changePlayback(this.getData().id, 'repeat', repeat !== 'none');

          // Wait 5 sec for the queueChanged event
          await this._waitForEvent('queueChanged', 5000);

        } else {
          await this.setUnavailable(this.homey.__("error.authenticationIssues"));
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_TIMEOUT':
            this.error(`Timeout error with speaker_repeat: ${error?.message}`);
            this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
            throw new Error(this.homey.__("error.playback.timeout"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication: ${error?.message}`);
            await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;
          case 'ERROR_NOT_SUPPORTED':
            this.error(`Error during speaker_playing: ${error?.message}`);
            this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
            throw new Error(this.homey.__("error.playback.notSupported"));
          case 'ERROR_PLAYBACK':
            this.error(`Error during speaker_repeat: ${error?.message}`);
            this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
            throw new Error(this.homey.__("error.playback.generic"));
          default:
            this.error('Error in speaker_repeat capability:', error);
            this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
        }
      }
    });
  }

  _initEchoDevices(id) {
    this.homey.app.echoConnect.getVolumeDevice(id)
      .then(volume => {
        this.log(`Device - initEchoDevices - getVolumeDevice - id: ${id} - volume: ${volume}`)

        this.setCapabilityValue('volume_set', (volume / 100)).catch(this.error);
      })
      .catch(error => this.error(error.message));

    this.homey.app.echoConnect.getPlayerInfo(id)
      .then(async (playerInfo) => {
        if (playerInfo && typeof playerInfo === 'object' && playerInfo.mediaId) {
          this.log(`Device - initEchoDevices - getPlayerInfo - id: ${id} - playerInfo: ${JSON.stringify(playerInfo, null, 2)}`)

          this.setStoreValue('mediaId', playerInfo.mediaId);

          this.log('Device - initEchoDevices - getPlayerInfo - loading art album:', playerInfo?.mainArt?.url ?? '');
          this.albumArt.setUrl(playerInfo?.mainArt?.url ?? '');
          //await this.setAlbumArtImage(this.albumArt);
          await this.albumArt.update();

          this.setCapabilityValue('speaker_artist', playerInfo?.infoText?.subText1 ?? '').catch(this.error);
          this.setCapabilityValue('speaker_album', playerInfo?.infoText?.subText2 ?? '').catch(this.error);
          this.setCapabilityValue('speaker_track', playerInfo?.infoText?.title ?? '').catch(this.error);
          this.setCapabilityValue('speaker_playing', playerInfo?.state === 'PLAYING').catch(this.error);
        } else {
          this.log(`Device - initEchoDevices - getPlayerInfo - id: ${id} - NO playerInfo`);

          this.setStoreValue('mediaId', null);

          this.albumArt.setUrl(null);
          await this.albumArt.update();

          this.setCapabilityValue('speaker_artist', null).catch(this.error);
          this.setCapabilityValue('speaker_album', null).catch(this.error);
          this.setCapabilityValue('speaker_track', null).catch(this.error);
          this.setCapabilityValue('speaker_playing', false).catch(this.error);
        }
      })
      .catch(error => this.error(error.message));
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('[onInit] ' + this.getName() + ' (' + this.getData().id + ') has been initialized - isPushConnected: ' + this.homey.app.echoConnect.isPushConnected());

    this.log('[onInit] disableAllDevices:', this.homey.app.disableAllDevices);

    if (!this.homey.app.disableAllDevices) {
      //Initialize the websocket control variables
      this.wsVolumeChanged = true;
      this.wsQueueChanged = true;

      //Initialize one Album art for every device 
      this.albumArt = await this.homey.images.createImage();
      await this.setAlbumArtImage(this.albumArt);

      //Register Alexa listener
      this._registerAlexaListener();

      //Register Homey listener
      this._registerHomeyListener();

      //Init echo devices
      this._initEchoDevices(this.getData().id);

    } else {
      this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);

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

    if (this.albumArt) {
      await this.albumArt.unregister();
    }
  }

}

module.exports = MyDevice;
