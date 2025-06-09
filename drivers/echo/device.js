'use strict';

const Homey = require('homey');
const { AlexaError } = require('../../lib/EchoConnect');

// Device capabilities configuration
const DEVICE_CAPABILITIES = [
  "speaker_album",
  "speaker_artist",
  "speaker_next",
  "speaker_playing",
  "speaker_prev",
  "speaker_repeat",
  "volume_set",
  "speaker_shuffle",
  "speaker_track",
  "echo_volume",
  "echo_groups"
];

// Error codes constants
const ERROR_CODES = {
  TIMEOUT: 'ERROR_TIMEOUT',
  INIT: 'ERROR_INIT',
  PUSH: 'ERROR_PUSH',
  AUTHENTICATION: 'ERROR_AUTHENTICATION',
  VOLUME: 'ERROR_VOLUME',
  PLAYBACK: 'ERROR_PLAYBACK',
  NOT_SUPPORTED: 'ERROR_NOT_SUPPORTED'
};

// Default timeout values
const TIMEOUTS = {
  EVENT_WAIT: 5000,
  VOLUME_CHANGE: 5000,
  PLAYBACK_CHANGE: 5000
};

class EchoDevice extends Homey.Device {

  /**
   * Check and add missing capabilities
   * @private
   */
  async _checkCapabilities() {
    const promises = DEVICE_CAPABILITIES.map(capability => {
      if (!this.hasCapability(capability)) {
        return this.addCapability(capability).catch(this.error);
      }
      return Promise.resolve();
    });

    await Promise.all(promises);
  }

  /**
   * Check if this specific device is online and update its availability status
   * @private
   */
  async _checkStatus() {
    try {
      const deviceId = this.getData().id;
      const isOnline = await this.homey.app.echoConnect.isOnLine(deviceId);

      if (isOnline) {
        this.log(`[checkStatus] Device ${this.getName()} is online.`);
        await this.setAvailable().catch(this.error);
      } else {
        this.error(`[checkStatus] Device ${this.getName()} is offline.`);
        await this.setUnavailable(this.homey.__("error.offline")).catch(this.error);
      }
    } catch (error) {
      this.error('[checkStatus] Error:', error);
    }
  }

  /**
   * Wait for a specific event with timeout
   * @param {string} event - Event name to wait for
   * @param {number} timeout - Timeout in milliseconds
   * @param {string} errorMessage - Custom error message
   * @returns {Promise} Promise that resolves when event occurs or rejects on timeout
   * @private
   */
  _waitForEvent(event, timeout = TIMEOUTS.EVENT_WAIT, errorMessage) {
    return new Promise((resolve, reject) => {
      const eventHandler = () => {
        this.homey.clearTimeout(timeoutId);
        resolve();
      };

      this.homey.app.echoConnect.once(event, eventHandler);

      const timeoutId = this.homey.setTimeout(() => {
        this.homey.app.echoConnect.removeListener(event, eventHandler);
        reject(new AlexaError(ERROR_CODES.TIMEOUT, errorMessage || `Timeout waiting for event: ${event}`));
      }, timeout);
    });
  }

  /**
   * Handle capability listener errors in a centralized way
   * @param {Error} error - The error that occurred
   * @param {string} capability - The capability that failed
   * @private
   */
  async _handleCapabilityError(error, capability) {
    switch (error?.code) {
      case ERROR_CODES.TIMEOUT:
        this.error(`Timeout error with ${capability}: ${error?.message}`);
        return this._handleTimeoutError(capability);

      case ERROR_CODES.INIT:
      case ERROR_CODES.PUSH:
      case ERROR_CODES.AUTHENTICATION:
        this.error(`Authentication error: ${error?.message}`);
        return this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);

      case ERROR_CODES.NOT_SUPPORTED:
        this.error(`Error during ${capability}: ${error?.message}`);
        if (capability === 'speaker_repeat') {
          this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
        }
        throw new Error(this.homey.__("error.playback.notSupported"));

      case ERROR_CODES.VOLUME:
        this.error(`Error in setting volume device: ${error?.message}`);
        throw new Error(this.homey.__("error.volume.generic"));

      case ERROR_CODES.PLAYBACK:
        this.error(`Error during ${capability}: ${error?.message}`);
        if (capability === 'speaker_repeat') {
          this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
        }
        throw new Error(this.homey.__("error.playback.generic"));

      default:
        this.error(`Error in ${capability} capability:`, error);
        if (capability === 'speaker_repeat') {
          this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
        }
        throw new Error(this.homey.__("error.generic"));
    }
  }

  /**
   * Handle timeout-specific errors for different capabilities
   * @param {string} capability - The capability that timed out
   * @private
   */
  _handleTimeoutError(capability) {
    switch (capability) {
      case 'volume_set':
        throw new Error(this.homey.__("error.volume.timeout"));

      case 'speaker_playing':
        // Reset player state on timeout
        this._resetPlayerState();
        throw new Error(this.homey.__("error.playback.timeout"));

      case 'speaker_repeat':
        this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
        throw new Error(this.homey.__("error.playback.timeout"));

      default:
        throw new Error(this.homey.__("error.playback.timeout"));
    }
  }

  /**
   * Reset player state to default values
   * @private
   */
  async _resetPlayerState() {
    try {
      this.setStoreValue('mediaId', null);

      if (this.albumArt) {
        this.albumArt.setUrl(null);
        await this.albumArt.update();
      }

      await Promise.all([
        this.setCapabilityValue('speaker_artist', null).catch(this.error),
        this.setCapabilityValue('speaker_album', null).catch(this.error),
        this.setCapabilityValue('speaker_track', null).catch(this.error),
        this.setCapabilityValue('speaker_playing', false).catch(this.error)
      ]);
    } catch (error) {
      this.error('Error resetting player state:', error);
    }
  }

  /**
   * Common handler for playback-related capabilities
   * @param {string} action - The playback action (play, pause, next, previous, etc.)
   * @param {*} value - The value for the action (if applicable)
   * @private
   */
  async _handlePlaybackCapability(action, value = null) {
    const cookieData = this.homey.settings.get('cookie');
    const amazonPage = this.homey.settings.get('amazonPage');

    try {
      const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

      if (!isConnected) {
        await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        return;
      }

      // Get device or group ID
      const id = this.getStoreValue('groupId') || this.getData().id;

      // Execute the playback command
      switch (action) {
        case 'play':
        case 'pause':
          await this.homey.app.echoConnect.changePlayback(id, action);
          await this._waitForEvent('playerChanged', TIMEOUTS.PLAYBACK_CHANGE);
          break;

        case 'next':
        case 'previous':
          await this.homey.app.echoConnect.changePlayback(id, action);
          await this._waitForEvent('playerChanged', TIMEOUTS.PLAYBACK_CHANGE);
          break;

        case 'shuffle':
          this.wsQueueChanged = false;
          await this.homey.app.echoConnect.changePlayback(id, 'shuffle', value);
          await this._waitForEvent('queueChanged', TIMEOUTS.PLAYBACK_CHANGE);
          break;

        case 'repeat':
          this.wsQueueChanged = false;
          await this.homey.app.echoConnect.changePlayback(id, 'repeat', value !== 'none');
          await this._waitForEvent('queueChanged', TIMEOUTS.PLAYBACK_CHANGE);
          break;
      }

    } catch (error) {
      await this._handleCapabilityError(error, `speaker_${action}`);
    }
  }

  /**
   * Update player information from playerInfo object
   * @param {Object} playerInfo - Player information object
   * @private
   */
  async _updatePlayerInfo(playerInfo) {
    try {
      this.setStoreValue('mediaId', playerInfo.mediaId);

      const artworkUrl = playerInfo?.mainArt?.url || null;
      this.log('Device - updating album art:', artworkUrl);

      if (this.albumArt) {
        this.albumArt.setUrl(artworkUrl);
        await this.albumArt.update();
      }

      // Update all player-related capabilities
      await Promise.all([
        this.setCapabilityValue('speaker_artist', playerInfo?.infoText?.subText1 || '').catch(this.error),
        this.setCapabilityValue('speaker_album', playerInfo?.infoText?.subText2 || '').catch(this.error),
        this.setCapabilityValue('speaker_track', playerInfo?.infoText?.title || '').catch(this.error),
        this.setCapabilityValue('speaker_playing', playerInfo?.state === 'PLAYING').catch(this.error)
      ]);

      // Check if device is in a group
      const echoGroups = this._checkIfInGroup(playerInfo);
      this.setCapabilityValue('echo_groups', echoGroups).catch(this.error);

    } catch (error) {
      this.error('Error updating player info:', error);
    }
  }

  /**
   * Check if device is part of a group
   * @param {Object} playerInfo - Player information object
   * @returns {boolean} True if device is in a group
   * @private
   */
  _checkIfInGroup(playerInfo) {
    if (playerInfo?.lemurVolume?.memberVolume && typeof playerInfo.lemurVolume.memberVolume === 'object') {
      const groupMembers = Object.keys(playerInfo.lemurVolume.memberVolume);
      return groupMembers.includes(this.getData().id);
    }
    return false;
  }

  /**
   * Update player details (common code for group and single device scenarios)
   * @param {string} mediaId - Media ID
   * @param {Object} track - Track information object
   * @private
   */
  async _updatePlayerDetails(mediaId, track) {
    if (mediaId !== this.getStoreValue('mediaId')) {
      try {
        this.setStoreValue('mediaId', mediaId);

        this.log('Device - playerChanged - loading art album ' + track.artwork + ' in ' + this.getData().id);
        this.albumArt.setUrl(track.artwork);
        await this.albumArt.update();

        this.setCapabilityValue('speaker_artist', track.artist).catch(this.error);
        this.setCapabilityValue('speaker_album', track.album).catch(this.error);
        this.setCapabilityValue('speaker_track', track.title).catch(this.error);
      } catch (error) {
        this.error('Error updating player details:', error);
      }
    }
  }



  /**
   * Register Alexa event listeners
   * @private
   */
  _registerAlexaListener() {
    // Add listener for the Alexa event 'queueChanged' that manage queue changes (shuffle and loop mode)
    this.homey.app.echoConnect.on('queueChanged', async (queueDetail) => {
      this.log('Device - queueChanged:', queueDetail.deviceSerialNumber);

      if (this.getData().id === queueDetail.deviceSerialNumber) {
        this.log(`queueChanged called - id: ${queueDetail.deviceSerialNumber} - shuffle: ${queueDetail.playBackOrder} - repeat: ${queueDetail.loopMode}`);

        // Update the shuffle capabilities - value: true/false
        this.setCapabilityValue('speaker_shuffle', (queueDetail.playBackOrder === 'SHUFFLE_ALL')).catch(this.error);

        // Update the repeat capabilities - value: 'track'/'playlist'/'none' - 'playlist' is not supported by Echo devices
        this.setCapabilityValue('speaker_repeat', (queueDetail.loopMode === 'LOOP_QUEUE' ? 'track' : 'none')).catch(this.error);
      }
    });

    // Add listener for the Alexa event 'playerChanged' that manage player changes
    this.homey.app.echoConnect.on('playerChanged', async (playerDetail) => {
      this.log('Device - playerChanged:', playerDetail.serial);

      if (playerDetail.isPlayingInGroup) {
        this.log('Device - playerChanged - playing in group');

        const groupMembers = Object.keys(playerDetail.groupMember);
        groupMembers.forEach(async member => {
          if (this.getData().id === member) {
            // Update player details if media has changed
            if (playerDetail.mediaId !== this.getStoreValue('mediaId')) {
              const track = {
                artwork: playerDetail.track.artwork,
                artist: playerDetail.track.artist,
                album: playerDetail.track.album,
                title: playerDetail.track.title
              };
              await this._updatePlayerDetails(playerDetail.mediaId, track);
            }

            this.log(`Device - playerChanged - id: ${playerDetail.serial} - playing: ${playerDetail.state}`);
            this.setStoreValue('groupId', playerDetail.serial);
            this.setCapabilityValue('speaker_playing', playerDetail.state).catch(this.error);
            this.setCapabilityValue('echo_groups', true).catch(this.error);
          }
        });
      } else {
        if (this.getData().id === playerDetail.serial) {
          this.log('Device - playerChanged - playing in single device');

          // Update player details if media has changed
          if (playerDetail.mediaId !== this.getStoreValue('mediaId')) {
            const track = {
              artwork: playerDetail.track.artwork,
              artist: playerDetail.track.artist,
              album: playerDetail.track.album,
              title: playerDetail.track.title
            };
            await this._updatePlayerDetails(playerDetail.mediaId, track);
          }

          this.log(`Device - playerChanged - id: ${playerDetail.serial} - playing: ${playerDetail.state}`);
          this.setStoreValue('groupId', null);
          this.setCapabilityValue('speaker_playing', playerDetail.state).catch(this.error);
          this.setCapabilityValue('echo_groups', false).catch(this.error);
        }
      }
    });

    // Add listener for the Alexa event 'volumeChanged' that manage volume changes
    this.homey.app.echoConnect.on('volumeChanged', (serial, newVolume) => {
      if (this.getData().id === serial) {
        this.log(`volumeChanged called - id: ${serial} - volume: ${newVolume}`);

        // Set the volume of the slider
        this.setCapabilityValue('volume_set', (newVolume / 100)).catch(this.error);

        // Set the volume of the sensor
        this.setCapabilityValue('echo_volume', newVolume).catch(this.error);
      }
    });

    this.homey.app.echoConnect.on('alexaCalled', async (alexaCallData) => {
      // Check if this event is for this specific device
      if (this.getData().id === alexaCallData.deviceSerial) {
        await this.setAvailable().catch(this.error);
      }
    });
  }

  /**
   * Register Homey capability listeners
   * @private
   */
  _registerHomeyListener() {
    const cookieData = this.homey.settings.get('cookie');
    const amazonPage = this.homey.settings.get('amazonPage');

    this.registerCapabilityListener("volume_set", async (value) => {
      this.log('Device - registerHomeyListener - volume_set:', value * 100);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);
        if (isConnected) {
          this.wsVolumeChanged = false;

          // Set the volume of the echo
          await this.homey.app.echoConnect.setVolumeDevice(this.getData().id, (value * 100));

          // Set the volume of the sensor
          this.setCapabilityValue('echo_volume', value * 100).catch(this.error);

          // Wait for the volumeChanged event
          await this._waitForEvent('volumeChanged', TIMEOUTS.VOLUME_CHANGE);

        } else {
          await this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        await this._handleCapabilityError(error, 'volume_set');
      }
    });

    this.registerCapabilityListener("speaker_playing", async (value) => {
      this.log('Device - registerHomeyListener - speaker_playing:', value);
      await this._handlePlaybackCapability(value ? 'play' : 'pause');
    });

    this.registerCapabilityListener("speaker_next", async () => {
      this.log('Device - registerHomeyListener - speaker_next');
      await this._handlePlaybackCapability('next');
    });

    this.registerCapabilityListener("speaker_prev", async () => {
      this.log('Device - registerHomeyListener - speaker_prev');
      await this._handlePlaybackCapability('previous');
    });

    this.registerCapabilityListener("speaker_shuffle", async (value) => {
      this.log('Device - registerHomeyListener - speaker_shuffle:', value);
      await this._handlePlaybackCapability('shuffle', value);
    });

    this.registerCapabilityListener("speaker_repeat", async (value) => {
      this.log('Device - registerHomeyListener - speaker_repeat:', value);

      if (value === 'playlist') {
        this.log('Device - registerHomeyListener - speaker_repeat - value: playlist is not supported by Echo devices');
        this.setCapabilityValue('speaker_repeat', 'none').catch(this.error);
        return;
      }

      await this._handlePlaybackCapability('repeat', value);
    });
  }

  /**
   * Initialize Echo device state and capabilities
   * @param {string} id - Device ID
   * @private
   */
  async _initEchoDevices(id) {
    try {
      // Get initial volume
      const volume = await this.homey.app.echoConnect.getVolumeDevice(id);
      this.log(`Device - initEchoDevices - getVolumeDevice - id: ${id} - volume: ${volume}`);

      // Set the volume of the slider
      this.setCapabilityValue('volume_set', (volume / 100)).catch(this.error);

      // Set the volume of the sensor
      this.setCapabilityValue('echo_volume', volume).catch(this.error);
    } catch (error) {
      this.error('Error getting volume:', error.message);
    }

    try {
      // Get initial player info
      const playerInfo = await this.homey.app.echoConnect.getPlayerInfo(id);

      if (playerInfo && typeof playerInfo === 'object' && playerInfo.mediaId) {
        this.log(`Device - initEchoDevices - getPlayerInfo - id: ${id} - playerInfo: ${JSON.stringify(playerInfo, null, 2)}`);
        await this._updatePlayerInfo(playerInfo);
      } else {
        this.log(`Device - initEchoDevices - getPlayerInfo - id: ${id} - NO playerInfo`);
        await this._resetPlayerState();
        this.setCapabilityValue('echo_groups', false).catch(this.error);
      }
    } catch (error) {
      this.error('Error getting player info:', error.message);
    }
  }

  /**
   * Device initialization
   */
  async onInit() {
    this.log('[onInit] ' + this.getName() + ' (' + this.getData().id + ') has been initialized - isPushConnected: ' + this.homey.app.echoConnect.isPushConnected());

    this.log('[onInit] disableAllDevices:', this.homey.app.disableAllDevices);

    // Check if all capabilities are present
    await this._checkCapabilities();

    // Check if the device is online
    await this._checkStatus();

    if (!this.homey.app.disableAllDevices) {
      try {
        // Initialize the websocket control variables
        this.wsVolumeChanged = true;
        this.wsQueueChanged = true;

        // Initialize one Album art for every device 
        this.albumArt = await this.homey.images.createImage();
        await this.setAlbumArtImage(this.albumArt);

        // Register Alexa listener
        this._registerAlexaListener();

        // Register Homey listener
        this._registerHomeyListener();

        // Init echo devices
        await this._initEchoDevices(this.getData().id);
      } catch (error) {
        this.error('Error during initialization:', error);
      }
    } else {
      this.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
    }
  }

  /**
   * Device uninitialization
   */
  async onUninit() {
    this.log('Device - onUninit has been called');
  }

  /**
   * Called when device is added
   */
  async onAdded() {
    this.log('MyDevice has been added');
  }

  /**
   * Handle settings changes
   * @param {Object} options - Settings change options
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('MyDevice settings were changed');

    // ONLY FOR TEST - TO DELETE OR COMMENT
    //this.homey.app.echoConnect.stopPushMessage();
  }

  /**
   * Handle device rename
   * @param {string} name - New device name
   */
  async onRenamed(name) {
    this.log('MyDevice was renamed');
  }

  /**
   * Called when device is deleted
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');

    if (this.albumArt) {
      await this.albumArt.unregister();
    }
  }

}

module.exports = EchoDevice;
