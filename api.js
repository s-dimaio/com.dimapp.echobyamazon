let devicesPath;

  /**
 * Saves all the extracted devices in a JSON file.
 *
 * @async
 * @returns {Promise<void>}
 * @throws {Error} If there's an error saving the devices.
 *
 * @example
 * try {
 *   await saveAllDevices();
 *   console.log('Devices saved successfully!');
 * } catch (error) {
 *   console.error('Error saving devices:', error);
 * }
 */
  async function saveAllDevices(homey) {
    const Path = require('path');
    const Fs = require('fs').promises;
    devicesPath = Path.join('/userdata', 'alexa-devices.json');

    console.log('Api - saveAllDevices - devicesPath:', devicesPath);

    try {
      await Fs.writeFile(devicesPath, JSON.stringify(homey.app.echoConnect.devices, null, 2));
      console.log("Dispositivi salvati con successo");

      return true; // Ritorniamo true se il salvataggio è avvenuto con successo
    } catch (err) {
      console.error("Errore nel salvataggio dei dispositivi:", err);
      throw err; // Rilanciamo l'errore per gestirlo in addSomething
    }
  }


module.exports = {

    /**
     * Retrieves the local IPv4 address of the machine.
     *
     * @returns {string} The local IPv4 address, or '0.0.0.0' if none is found.
     *
     * @example
     * const ipAddress = getIPAddress();
     * console.log('Local IP Address:', ipAddress);
     */
    // getIPAddress() {
    //     const Os = require('os');
    //     const interfaces = Os.networkInterfaces();
    //     for (const devName in interfaces) {
    //         const iface = interfaces[devName];
    //         for (let i = 0; i < iface.length; i++) {
    //             const alias = iface[i];
    //             if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
    //                 return alias.address;
    //             }
    //         }
    //     }
    //     return '0.0.0.0';
    // },



    async createDevicesFile({ homey }) {
        console.log('addSomething called');

        try {
            await saveAllDevices(homey);
            const fullPath = `http://${homey.app.echoConnect.getIPAddress()}/app/com.dimapp.echobyamazon${devicesPath}`;
            return fullPath;
        } catch (err) {
            throw new Error('Impossibile creare il file');
        }
    }
};