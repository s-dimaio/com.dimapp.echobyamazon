/**
 * Save all devices to a JSON file.
 * @param {Object} homey - The Homey object.
 * @returns {Promise<string>} The path to the saved devices file.
 * @example
 * const devicesPath = await saveAllDevices(homey);
 */
async function saveAllDevices(homey) {
  const Path = require('path');
  const Fs = require('fs').promises;
  const devicesPath = Path.join('/userdata', 'alexa-devices.json');

  console.log('Api - saveAllDevices - devicesPath:', devicesPath);

  try {
    const devices = await homey.app.echoConnect.getDevices();
    await Fs.writeFile(devicesPath, JSON.stringify(devices, null, 2));
    console.log("Devices saved successfully");

    return devicesPath;

  } catch (err) {
    console.error("Error saving devices:", err);
    throw err; // Re-throw the error to handle it in addSomething

  }
}

module.exports = {
  /**
   * Create a devices file and return its URL.
   * @param {Object} params - The parameters object.
   * @param {Object} params.homey - The Homey object.
   * @returns {Promise<string>} The URL to the devices file.
   * @example
   * const fileUrl = await createDevicesFile({ homey });
   */
  async createDevicesFile({ homey }) {
    console.log('createDevicesFile called');

    try {
      const devicesPath = await saveAllDevices(homey);
      const fullPath = `http://${homey.app.echoConnect.getIPAddress()}/app/com.dimapp.echobyamazon${devicesPath}`;

      return fullPath;
    } catch (err) {
      throw new Error('Unable to create the file');
    }
  },

  /**
   * Get the server status.
   * @param {Object} params - The parameters object.
   * @param {Object} params.homey - The Homey object.
   * @returns {Promise<Object>} The server status.
   * @example
   * const status = await getServerStatus({ homey });
   */
  async getServerStatus({ homey }) {
    console.log('getServerStatus called');

    try {
      const isAuth = await homey.app.echoConnect.isAuthenticated();
      console.log(isAuth ? 'Authenticated with Alexa' : 'Not authenticated with Alexa');

      if (isAuth) {
        return {
          status: true,
          msg: homey.__("settings.connection.server.ok")
        };
      } else {
        return {
          status: false,
          msg: homey.__("settings.connection.server.error")
        };
      }
    } catch (error) {
      throw new Error(`Server Error: ${error.message}`);
    }
  },

  /**
   * Get the WebSocket status.
   * @param {Object} params - The parameters object.
   * @param {Object} params.homey - The Homey object.
   * @returns {Promise<Object>} The WebSocket status.
   * @example
   * const status = await getWebSocketStatus({ homey });
   */
  async getWebSocketStatus({ homey }) {
    console.log('getWebSocketStatus called');

    try {
      const isPushConnected = homey.app.echoConnect.isPushConnected();

      if (isPushConnected) {
        return {
          status: true,
          msg: homey.__("settings.connection.ws.ok")
        };
      } else {
        return {
          status: false,
          msg: homey.__("settings.connection.ws.error")
        };
      }
    } catch (error) {
      throw new Error('WebSocket Error');
    }
  },

  /**
   * Disconnect from Alexa.
   * @param {Object} params - The parameters object.
   * @param {Object} params.homey - The Homey object.
   * @returns {Promise<void>}
   * @example
   * await disconnectAlexa({ homey });
   */
  async disconnectAlexa({ homey }) {
    console.log('disconnectAlexa called');

    try {
      homey.app.echoConnect.stopPushMessage();
      homey.settings.unset('cookie');

    } catch (error) {
      throw new Error('Error during disconnection');
    }
  }
};