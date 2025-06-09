'use strict';

const Homey = require('homey');

class EchoDriver extends Homey.Driver {

  // Supported action types constant
  static get SUPPORTED_ACTIONS() {
    return ['speak', 'announce', 'whisper', 'command', 'routine', 'notification'];
  }

  // Error codes constant
  static get ERROR_CODES() {
    return {
      SPEAK: 'ERROR_SPEAK',
      COMMAND: 'ERROR_COMMAND', 
      ROUTINE: 'ERROR_ROUTINE',
      NOTIFICATION: 'ERROR_NOTIFICATION',
      DISPLAY_SETTING: 'ERROR_DISPLAY_SETTING',
      AUTHENTICATION: 'ERROR_AUTHENTICATION',
      INIT: 'ERROR_INIT',
      PUSH: 'ERROR_PUSH',
      INVALID_SERIAL: 'INVALID_SERIAL',
      INVALID_ENABLED_SETTING: 'INVALID_ENABLED_SETTING'
    };
  }

  /**
   * Create a JSON object with the format accepted by Homey for devices
   * @param {Array} echoDevices - Array of Echo devices from Amazon API
   * @returns {Array} Array of formatted device objects for Homey
   */
  _formatDevicesForHomey(echoDevices) {
    if (!echoDevices) {
      this.error('echoDevices is not defined');
      return [];
    }

    if (!Array.isArray(echoDevices)) {
      this.error('echoDevices is not an array');
      return [];
    }

    return echoDevices.map(device => {
      // Validate required device properties
      if (!device.serialNumber) {
        this.error(`Device missing serialNumber: ${JSON.stringify(device)}`);
        return null;
      }
      
      return {
        name: device.accountName || 'Unknown Device',
        data: {
          id: device.serialNumber
        },
        settings: {
          deviceFamily: device.deviceFamily || 'unknown',
          deviceType: device.deviceType || 'unknown',
          serialNumber: device.serialNumber
        },
        icon: `ic_${(device.deviceFamily || 'default').toLowerCase()}.svg`
      };
    }).filter(Boolean); // Remove null entries from failed mappings
  }

  /**
   * Executes various Alexa actions on a specified Echo device.
   * 
   * @async
   * @param {string} id - The unique identifier of the Echo device.
   * @param {string} content - The content to be processed (e.g., text to speak, command to execute, routine name).
   * @param {'speak' | 'announce' | 'whisper' | 'command' | 'routine' | 'notification'} action - The type of action to perform.
   * @throws {Error} Throws an error if the action is not supported or if there's an issue executing the action.
   * @returns {Promise<any>} A promise that resolves with the result of the action, if any.
   * 
   * @example
   * // Make Alexa speak
   * await executeEchoAction('device123', 'Hello, how are you?', 'speak');
   * 
   * // Execute an Alexa command
   * await executeEchoAction('device123', 'What's the weather like?', 'command');
   * 
   * // Start a routine
   * await executeEchoAction('device123', 'MorningRoutine', 'routine');
   */
  async executeEchoAction(id, content, action) {
    // Validate input parameters
    if (!id) {
      const error = new Error('Device ID is required');
      error.code = EchoDriver.ERROR_CODES.INVALID_SERIAL;
      throw error;
    }

    if (!EchoDriver.SUPPORTED_ACTIONS.includes(action)) {
      this.error(`Action not supported: ${action}`);
      const error = new Error(`Unsupported action: ${action}`);
      error.code = 'UNSUPPORTED_ACTION';
      throw error;
    }

    this.log(`Driver - executeEchoAction - id: ${id} - content: ${content} - action: ${action}`);

    try {
      let result;
      switch (action) {
        case 'speak':
        case 'announce':
        case 'whisper':
          result = await this.homey.app.echoConnect.speakEcho(id, content, action);
          break;
        case 'command':
          result = await this.homey.app.echoConnect.executeAlexaCommand(id, content);
          break;
        case 'routine':
          result = await this.homey.app.echoConnect.executeAutomationRoutine(id, content);
          break;
        case 'notification':
          const localTime = new Date().toLocaleString(undefined, { timeZone: this.homey.clock.getTimezone() });
          // Create notification with 5 second delay from current local time
          result = await this.homey.app.echoConnect.createAlexaNotification(
            id, 
            'Reminder', 
            content, 
            new Date(localTime).getTime() + 5000, 
            "ON"
          );
          break;
        default:
          // This should never happen due to validation above, but keep for safety
          this.error(`Action not supported: ${action}`);
          const error = new Error(`Unsupported action: ${action}`);
          error.code = 'UNSUPPORTED_ACTION';
          throw error;
      }
      return result;

    } catch (error) {
      this.error(`Error while running ${action}:`, error.message);
      throw error;
    }
  }

  /**
   * Common handler for action card execution with validation and error handling
   * @param {string} actionType - Type of action being executed
   * @param {Object} args - Arguments from the flow card
   * @param {Function} executeAction - Function to execute the specific action
   * @private
   */
  async _handleActionCardExecution(actionType, args, executeAction) {
    const serial = args.device.getData().id;
    const content = args[actionType] || args.message || args.command;
    const cookieData = this.homey.settings.get('cookie');
    const amazonPage = this.homey.settings.get('amazonPage');

    // Common validation for content-based actions
    if (content && content.trim().length === 0) {
      this.error(`Driver - ${actionType}ActionCard - content is empty`);
      throw new Error(this.homey.__(`error.${actionType}Empty`));
    }

    // Check device online status
    if (!this.homey.app.echoConnect.isOnLine(serial)) {
      this.error(`Driver - ${actionType}ActionCard - ${serial} is offline`);
      throw new Error(this.homey.__("error.offline"));
    }

    this.log(`Driver - ${actionType} flow content: ${content}`);

    try {
      const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

      if (isConnected) {
        await executeAction(serial, content);
        this.log(`${actionType} executed successfully`);
      } else {
        await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
      }
    } catch (error) {
      await this._handleActionError(error, args.device, actionType);
    }
  }

  /**
   * Common error handler for action card execution
   * @param {Error} error - The error that occurred
   * @param {Object} device - The device object
   * @param {string} actionType - Type of action that failed
   * @private
   */
  async _handleActionError(error, device, actionType) {
    switch (error?.code) {
      case `ERROR_${actionType.toUpperCase()}`:
      case 'ERROR_SPEAK':
      case 'ERROR_COMMAND':
      case 'ERROR_ROUTINE':
      case 'ERROR_NOTIFICATION':
      case 'ERROR_DISPLAY_SETTING':
        this.error(`Error with ${actionType}:`, error?.message);
        throw new Error(this.homey.__("error.generic"));

      case 'INVALID_SERIAL':
        this.error('Invalid device serial:', error?.message);
        throw new Error(this.homey.__("error.invalidDevice"));

      case 'INVALID_ENABLED_SETTING':
        this.error('Invalid power setting:', error?.message);
        throw new Error(this.homey.__("error.invalidPowerSetting"));

      case 'ERROR_INIT':
      case 'ERROR_PUSH':
      case 'ERROR_AUTHENTICATION':
        this.error(`Authentication - ${error?.message}`);
        await device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        break;

      default:
        this.error(`Generic Error with ${actionType}:`, error);
        throw new Error(this.homey.__("error.generic"));
    }
  }

  /**
   * Setup routines action card with autocomplete functionality
   * @private
   */
  _setupRoutinesActionCard() {
    const alexaRoutinesActionCard = this.homey.flow.getActionCard("alexa-routines");
    
    // Register autocomplete listener for routine selection
    alexaRoutinesActionCard.registerArgumentAutocompleteListener(
      "routine",
      async (query, args) => {
        try {
          const echoRoutines = await this.homey.app.echoConnect.getRoutinesList();
          
          // Validate that we received an array
          if (!Array.isArray(echoRoutines)) {
            this.error('getRoutinesList did not return an array');
            return [];
          }

          // Map and filter routines
          const results = echoRoutines
            .filter(item => item?.name && item?.automationId) // Filter out invalid items
            .map(item => ({
              name: item.name,
              id: {
                automationId: item.automationId,
                sequence: item.sequence
              }
            }))
            .filter(result => 
              result.name.toLowerCase().includes(query.toLowerCase())
            );

          this.log(`Filtered routines: ${results.length} of ${echoRoutines.length}`);
          return results;

        } catch (error) {
          this.error("Error getting routines:", error);
          return [];
        }
      }
    );

    // Register run listener for routine execution
    alexaRoutinesActionCard.registerRunListener(async (args) => {
      const routineId = args.routine?.id;
      
      if (!routineId || typeof routineId !== 'object') {
        this.error('Driver - alexaRoutinesActionCard - invalid routineId');
        throw new Error(this.homey.__("error.routineEmpty"));
      }

      await this._handleActionCardExecution(
        'routine',
        { ...args, routine: routineId },
        (serial, content) => this.executeEchoAction(serial, content, 'routine')
      );
    });
  }

  /**
   * Setup display power action card
   * @private
   */
  _setupDisplayActionCard() {
    const echoDisplayActionCard = this.homey.flow.getActionCard('echo-display');
    
    echoDisplayActionCard.registerRunListener(async (args) => {
      const serial = args.device.getData().id;
      const power = args.power;
      const cookieData = this.homey.settings.get('cookie');
      const amazonPage = this.homey.settings.get('amazonPage');

      // Validate power setting
      if (!power || (power !== 'on' && power !== 'off')) {
        this.error('Driver - echoDisplayActionCard - invalid power setting');
        throw new Error(this.homey.__("error.invalidPowerSetting"));
      }

      // Check device online status
      if (!this.homey.app.echoConnect.isOnLine(serial)) {
        this.error(`Driver - echoDisplayActionCard - ${serial} is offline`);
        throw new Error(this.homey.__("error.offline"));
      }

      this.log(`Driver - echo-display flow power setting: ${power}`);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

        if (isConnected) {
          const enabled = power === 'on';
          const result = await this.homey.app.echoConnect.setDisplayPowerSetting(serial, enabled);
          this.log(`Display power set to ${power} successfully:`, result);
        } else {
          await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        await this._handleActionError(error, args.device, 'display');
      }
    });
  }

  /**
   * Initialize and register all Echo flow action cards
   * @private
   */
  _setEchoFlowActionCard() {
    // Configuration for standard action cards
    const actionCards = [
      {
        id: 'echo-speak',
        contentField: 'message',
        action: 'speak',
        errorKey: 'messageEmpty'
      },
      {
        id: 'echo-announcement', 
        contentField: 'announcement',
        action: 'announce',
        errorKey: 'announcementEmpty'
      },
      {
        id: 'echo-whisper',
        contentField: 'message', 
        action: 'whisper',
        errorKey: 'messageEmpty'
      },
      {
        id: 'alexa-command',
        contentField: 'command',
        action: 'command',
        errorKey: 'commandEmpty'
      },
      {
        id: 'alexa-notification',
        contentField: 'message',
        action: 'notification',
        errorKey: 'reminderEmpty'
      }
    ];

    // Register standard action cards using common handler
    actionCards.forEach(config => {
      const actionCard = this.homey.flow.getActionCard(config.id);
      actionCard.registerRunListener(async (args) => {
        await this._handleActionCardExecution(
          config.contentField,
          args,
          (serial, content) => this.executeEchoAction(serial, content, config.action)
        );
      });
    });

    // Setup special action cards
    this._setupRoutinesActionCard();
    this._setupDisplayActionCard();
  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('onInit - MyDriver has been initialized');

    this._setEchoFlowActionCard();
  }

  async onUninit() {
    this.log('Driver - onUninit has been called');

  }

  onRepair(session, device) {
    // Argument session is a PairSocket, similar to Driver.onPair
    // Argument device is a Homey.Device that's being repaired

    // Manages the AmazonPage radio button changes
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
          forceToken: true,
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

          try {
            const isAuthenticated = await this.homey.app.echoConnect.isAuthenticated();
            if (isAuthenticated) {
              this.log('You are already authenticated on Alexa servers');

              const isPushConnected = this.homey.app.echoConnect.isPushConnected();

              if (isPushConnected === false) {
                this.log('initPushMessage called!')
                this.homey.app.echoConnect.initPushMessage()
              }

              device.setAvailable().catch(this.error);
              session.done();

            } else {
              this.log('You need to re-authenticate.');

              // Set AlexaConnected callback to show devices list
              this.homey.app.setAlexaConnectedCallback(() => {
                this.log('device id ' + device.getData().id + ' - repaired');
                //device.setDeviceListener();
                device.setAvailable().catch(this.error);
                session.done();
              });

              await this.homey.app.echoConnect.initAlexa({
                cookieData: cookieData,
                amazonPage: amazonPage,
                closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
              });
            }
          } catch (error) {
            this.error('An error occurred:', error);
            await session.showView('alexa_repair_login');
          }

        } catch (err) {
          this.error('Error initializing Alexa: ', err);
          await session.showView('alexa_repair_login');
        }
      }
    });

    session.setHandler("disconnect", () => {
      this.log('onRepair - disconnect called')

      device.setDeviceVolume(device.getData().id);
    });
  }


  onPair(session) {

    // Manages the AmazonPage radio button changes
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

      //this.log(JSON.stringify(this.homey.app.echoConnect.echoDevices, null, 2));

      try {
        const echoDevices = await this.homey.app.echoConnect.getEchoDevices();
        const devicesForHomey = this._formatDevicesForHomey(echoDevices);
        this.log('Devices formatted:', devicesForHomey);

        return devicesForHomey;
      } catch (error) {
        this.error('Error during device retrieval:', error);

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

          try {
            const isAuthenticated = await this.homey.app.echoConnect.isAuthenticated();
            if (isAuthenticated) {
              this.log('You are already authenticated on Alexa servers');

              const isPushConnected = this.homey.app.echoConnect.isPushConnected();
              this.log('isPushConnected: ', isPushConnected);

              if (isPushConnected === false) {
                this.log('initPushMessage called!')
                this.homey.app.echoConnect.initPushMessage()
              }

              //Show devices list
              session.showView('list_my_devices');
            } else {
              this.log('You need to re-authenticate.');

              // Set AlexaConnected callback to show devies list
              this.homey.app.setAlexaConnectedCallback(() => {
                //Show devices list
                session.showView('list_my_devices');
              });

              await this.homey.app.echoConnect.initAlexa({
                cookieData: cookieData,
                amazonPage: amazonPage,
                closeWindowImageUrl: 'https://homey.app/img/heading/homey@2x.webp'
              });
            }
          } catch (error) {
            this.error('An error occurred:', error);
            await session.showView('alexa_login');
          }

        } catch (err) {
          this.error('Error initializing Alexa: ', err);
          await session.showView('alexa_login');
        }
      }
    });
  }
}

module.exports = EchoDriver;
