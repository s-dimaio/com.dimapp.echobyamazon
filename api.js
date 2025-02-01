let devicesPath;

async function saveAllDevices(homey) {
  const Path = require('path');
  const Fs = require('fs').promises;
  devicesPath = Path.join('/userdata', 'alexa-devices.json');

  console.log('Api - saveAllDevices - devicesPath:', devicesPath);

  try {
    const devices = await homey.app.echoConnect.getDevices();
    await Fs.writeFile(devicesPath, JSON.stringify(devices, null, 2));
    console.log("Dispositivi salvati con successo");

  } catch (err) {
    console.error("Errore nel salvataggio dei dispositivi:", err);
    throw err; // Rilanciamo l'errore per gestirlo in addSomething
  }
}

module.exports = {
  async createDevicesFile({ homey }) {
    console.log('addSomething called');

    try {
      await saveAllDevices(homey);
      const fullPath = `http://${homey.app.echoConnect.getIPAddress()}/app/com.dimapp.echobyamazon${devicesPath}`;
      return fullPath;
    } catch (err) {
      throw new Error('Impossibile creare il file');
    }
  },

  async getServerStatus({ homey }) {
    console.log('getServerStatus called');

    try {
      const isAuth = await homey.app.echoConnect.isAuthenticated();
      console.log(isAuth ? 'Authenticated with Alexa' : 'Not authenticated with Alexa');

      if (isAuth) {
        return homey.__("settings.connection.server.ok");
      } else {
        return homey.__("settings.connection.server.error");
      }
    } catch (error) {
      throw new Error('Server Error');
    }
  },

  async getWebSocketStatus({ homey }) {
    console.log('getWebSocketStatus called');

    try {
      const isPushConnected = homey.app.echoConnect.isPushConnected();

      if (isPushConnected) {
        return homey.__("settings.connection.ws.ok");
      } else {
        return homey.__("settings.connection.ws.error");
      }
    } catch (error) {
      throw new Error('WebSocket Error');
    }
  },

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