'use strict';

const Homey = require('homey');

class MyDriver extends Homey.Driver {

  // Create a Json with the format accepted by Homey for devices
  _formatDevicesForHomey(echoDevices) {
    if (!echoDevices) {
      console.error('echoDevices non è definito');
      return [];
    }

    return echoDevices.map(device => ({
      name: device.accountName,
      data: {
        id: device.serialNumber
      },
      settings: {
        deviceFamily: device.deviceFamily,
        deviceType: device.deviceType,
        serialNumber: device.serialNumber
      },
      icon: `ic_${device.deviceFamily.toLowerCase()}.svg`
    }));
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
          //result = await this.homey.app.echoConnect.createAlexaNotification(id, 'Reminder', content, new Date().getTime() + ((60 * 60 * 1000) + 5000), "ON");
          result = await this.homey.app.echoConnect.createAlexaNotification(id, 'Reminder', content, new Date(localTime).getTime() + 5000, "ON");
          break;
        default:
          this.error(`Action not supported: ${action}`);
      }
      return result;

    } catch (error) {
      this.error(`Error while running ${action}:`, error.message);
      throw error;
    }
  }

  _setEchoFlowActionCard() {
    const cookieData = this.homey.settings.get('cookie');
    const amazonPage = this.homey.settings.get('amazonPage');

    // Set 'echo-speak' flow card
    const speakActionCard = this.homey.flow.getActionCard('echo-speak');
    speakActionCard.registerRunListener(async (args) => {
      const serial = args.device.getData().id;
      const message = args.message;

      if (message.trim().length === 0) {
        this.error('Driver - speakActionCard - message is empty');
        throw new Error(this.homey.__("error.messageEmpty"));
      }

      if (!this.homey.app.echoConnect.isOnLine(serial)) {
        this.error(`Driver - speakActionCard - ${serial} is offline`);
        throw new Error(this.homey.__("error.offline"));
      }

      this.log(`Driver - setEchoFlowActionCard - echo-speak flow message: ${message}`);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

        if (isConnected) {
          await this.executeEchoAction(serial, message, 'speak');
          this.log('Message spoken successfully');
        } else {
          await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_SPEAK':
            this.error('Error speaking message:', error?.message);
            throw new Error(this.homey.__("error.generic"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication - ${error?.message}`);
            await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;

          default:
            this.error('Generic Error with Speak-Announcement-Whisper flow:', error);
        }
      }
    });

    // Set 'echo-announcement' flow card
    const announcementActionCard = this.homey.flow.getActionCard('echo-announcement');
    announcementActionCard.registerRunListener(async (args) => {
      const serial = args.device.getData().id;
      const announcement = args.announcement;

      if (announcement.trim().length === 0) {
        this.error('Driver - announcementActionCard - announcement is empty');
        throw new Error(this.homey.__("error.announcementEmpty"));
      }

      if (!this.homey.app.echoConnect.isOnLine(serial)) {
        this.error(`Driver - announcementActionCard - ${serial} is offline`);
        throw new Error(this.homey.__("error.offline"));
      }

      this.log(`Driver - setEchoFlowActionCard - echo-announcement flow message: ${announcement}`);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

        if (isConnected) {
          await this.executeEchoAction(serial, announcement, 'announce');
          this.log('Anouncement spoken successfully');
        } else {
          await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_SPEAK':
            this.error('Error speaking announcement:', error?.message);
            throw new Error(this.homey.__("error.generic"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication - ${error?.message}`);
            await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;

          default:
            this.error('Generic Error with Speak-Announcement-Whisper flow:', error);
        }
      }
    });

    // Set 'echo-whisper' flow card
    const whisperActionCard = this.homey.flow.getActionCard('echo-whisper');
    whisperActionCard.registerRunListener(async (args) => {
      const serial = args.device.getData().id;
      const message = args.message;

      if (message.trim().length === 0) {
        this.error('Driver - whisperActionCard - message is empty');
        throw new Error(this.homey.__("error.messageEmpty"));
      }

      if (!this.homey.app.echoConnect.isOnLine(serial)) {
        this.error(`Driver - whisperActionCard - ${serial} is offline`);
        throw new Error(this.homey.__("error.offline"));
      }

      this.log(`Driver - setEchoFlowActionCard - echo-whisper flow message: ${message}`);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

        if (isConnected) {
          await this.executeEchoAction(serial, message, 'whisper');
          this.log('Message whispered successfully');
        } else {
          await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_SPEAK':
            this.error('Error whispering message:', error?.message);
            throw new Error(this.homey.__("error.generic"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication - ${error?.message}`);
            await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;

          default:
            this.error('Generic Error with Speak-Announcement-Whisper flow:', error);
        }
      }
    });

    // Set 'alexa-command' flow card
    const alexaCommandActionCard = this.homey.flow.getActionCard('alexa-command');
    alexaCommandActionCard.registerRunListener(async (args) => {
      const serial = args.device.getData().id;
      const command = args.command;

      if (command.trim().length === 0) {
        this.error('Driver - alexaCommandActionCard - command is empty');
        throw new Error(this.homey.__("error.commandEmpty"));
      }

      if (!this.homey.app.echoConnect.isOnLine(serial)) {
        this.error(`Driver - alexaCommandActionCard - ${serial} is offline`);
        throw new Error(this.homey.__("error.offline"));
      }

      this.log(`Driver - setEchoFlowActionCard - alexa-command flow message: ${command}`);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

        if (isConnected) {
          await this.executeEchoAction(serial, command, 'command');
          this.log('Command sent successfully');
        } else {
          await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_COMMAND':
            this.error('Error sending command:', error?.message);
            throw new Error(this.homey.__("error.generic"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication - ${error?.message}`);
            await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;

          default:
            this.error('Generic Error with Speak-Announcement-Whisper flow:', error);
        }
      }
    });

    // Set 'alexa-routines' flow card
    const alexaRoutinesActionCard = this.homey.flow.getActionCard("alexa-routines");
    alexaRoutinesActionCard.registerArgumentAutocompleteListener(
      "routine",
      async (query, args) => {
        try {
          const echoRoutines = await this.homey.app.echoConnect.getRoutinesList();
          const results = echoRoutines.map(item => ({
            name: item.name,
            id: {
              automationId: item.automationId,
              sequence: item.sequence
            }
          }));

          this.log('echoRoutinesFlow:', JSON.stringify(results, null, 2));

          // filter based on the query
          return results.filter((result) => {
            return result.name.toLowerCase().includes(query.toLowerCase());
          });

        } catch (error) {
          console.error("Error getting routines:", error);
          return [];
        }
      }
    );
    alexaRoutinesActionCard.registerRunListener(async (args) => {
      const serial = args.device.getData().id;
      const routineId = args.routine.id;
      const name = args.routine.name;

      if (routineId.trim().length === 0) {
        this.error('Driver - alexaRoutinesActionCard - routineId is empty');
        throw new Error(this.homey.__("error.routineEmpty"));
      }

      if (!this.homey.app.echoConnect.isOnLine(serial)) {
        this.error(`Driver - alexaRoutinesActionCard - ${serial} is offline`);
        throw new Error(this.homey.__("error.offline"));
      }

      this.log(`Driver - setEchoFlowActionCard - alexa-routines flow message: ${routineId}`);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

        if (isConnected) {
          await this.executeEchoAction(serial, routineId, 'routine');
          this.log('Routine command sent successfully');
        } else {
          await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }
      } catch (error) {
        switch (error?.code) {
          case 'ERROR_ROUTINE':
            this.error('Error calling routine:', error?.message);
            throw new Error(this.homey.__("error.generic"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication - ${error?.message}`);
            await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;

          default:
            this.error('Generic Error with Speak-Announcement-Whisper flow:', error);
        }
      }
    });

    // Set 'alexa-notification' flow card
    const alexaNotificationActionCard = this.homey.flow.getActionCard('alexa-notification');
    alexaNotificationActionCard.registerRunListener(async (args) => {
      const serial = args.device.getData().id;
      const message = args.message;

      if (message.trim().length === 0) {
        this.error('Driver - alexaNotificationActionCard - message is empty');
        throw new Error(this.homey.__("error.reminderEmpty"));
      }

      if (!this.homey.app.echoConnect.isOnLine(serial)) {
        this.error(`Driver - alexaNotificationActionCard - ${serial} is offline`);
        throw new Error(this.homey.__("error.offline"));
      }

      this.log(`Driver - setEchoFlowActionCard - alexa-notification flow message: ${message}`);

      try {
        const isConnected = await this.homey.app.echoConnect.checkAuthenticationAndPush(cookieData, amazonPage);

        if (isConnected) {
          await this.executeEchoAction(serial, message, 'notification');
          this.log('Notification sent successfully');
        } else {
          await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
        }

      } catch (error) {
        switch (error?.code) {
          case 'ERROR_NOTIFICATION':
            this.error('Error sending notification:', error?.message);
            throw new Error(this.homey.__("error.generic"));

          case 'ERROR_INIT':
          case 'ERROR_PUSH':
          case 'ERROR_AUTHENTICATION':
            this.error(`Authentication - ${error?.message}`);
            await args.device.setUnavailable(this.homey.__("error.authenticationIssues")).catch(this.error);
            break;

          default:
            this.error('Generic Error with Speak-Announcement-Whisper flow:', error);
        }
      }
    });
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
          foceToken: true,
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
        this.log('Devices formatati:', devicesForHomey);

        return devicesForHomey;
      } catch (error) {
        this.error('Errore durante il recupero dei dispositivi:', error);

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

module.exports = MyDriver;
