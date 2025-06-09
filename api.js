'use strict';

const Path = require('path');
const Fs = require('fs').promises;

// Constants for better maintainability
const ERROR_CODES = {
  FILE_CREATION: 'FILE_CREATION_ERROR',
  DEVICE_FETCH: 'DEVICE_FETCH_ERROR',
  SERVER_STATUS: 'SERVER_STATUS_ERROR',
  WEBSOCKET_STATUS: 'WEBSOCKET_STATUS_ERROR',
  DISCONNECT: 'DISCONNECT_ERROR',
  VALIDATION: 'VALIDATION_ERROR'
};

const API_CONSTANTS = {
  DEVICES_FILE_NAME: 'alexa-devices.json',
  USER_DATA_PATH: '/userdata',
  APP_PATH_PREFIX: '/app/com.dimapp.echobyamazon',
  JSON_INDENT: 2,
  TIMEOUT_DEVICE_FETCH: 30000,
  TIMEOUT_AUTH_CHECK: 10000
};

/**
 * Custom error class for API operations
 * @class ApiError
 * @extends Error
 */
class ApiError extends Error {
  /**
   * Create an API error
   * @param {string} code - Error code from ERROR_CODES
   * @param {string} message - Error message
   * @param {Error} [originalError=null] - Original error that caused this
   */
  constructor(code, message, originalError = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Validate Homey object and required properties
 * @param {Object} homey - The Homey object to validate
 * @throws {ApiError} If validation fails
 * @private
 */
function validateHomeyObject(homey) {
  if (!homey) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Homey object is required');
  }

  if (!homey.app || !homey.app.echoConnect) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'EchoConnect instance not found in Homey app');
  }

  if (typeof homey.__ !== 'function') {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Homey internationalization function not available');
  }
}

/**
 * Validate API method parameters
 * @param {Object} params - Parameters object
 * @param {Object} params.homey - The Homey object
 * @throws {ApiError} If validation fails
 * @private
 */
function validateApiParams(params) {
  if (!params || typeof params !== 'object') {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Parameters object is required');
  }

  validateHomeyObject(params.homey);
}

/**
 * Save all devices to a JSON file with enhanced error handling
 * @param {Object} homey - The Homey object
 * @returns {Promise<string>} The path to the saved devices file
 * @throws {ApiError} If saving fails
 * @example
 * const devicesPath = await saveAllDevices(homey);
 */
async function saveAllDevices(homey) {
  validateHomeyObject(homey);

  const devicesPath = Path.join(API_CONSTANTS.USER_DATA_PATH, API_CONSTANTS.DEVICES_FILE_NAME);

  console.log('API - saveAllDevices - saving to:', devicesPath);

  try {
    // Fetch devices with timeout protection
    const devices = await Promise.race([
      homey.app.echoConnect.getDevices(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout fetching devices')), API_CONSTANTS.TIMEOUT_DEVICE_FETCH)
      )
    ]);

    if (!devices) {
      throw new Error('No devices data received');
    }

    // Ensure directory exists
    const dirPath = Path.dirname(devicesPath);
    await Fs.mkdir(dirPath, { recursive: true });

    // Save devices with proper formatting
    const devicesJson = JSON.stringify(devices, null, API_CONSTANTS.JSON_INDENT);
    await Fs.writeFile(devicesPath, devicesJson, 'utf8');

    console.log('API - saveAllDevices - devices saved successfully');
    return devicesPath;

  } catch (error) {
    console.error('API - saveAllDevices - error:', error.message);
    throw new ApiError(
      ERROR_CODES.DEVICE_FETCH,
      `Failed to save devices: ${error.message}`,
      error
    );
  }
}

module.exports = {
  /**
   * Create a devices file and return its URL
   * @param {Object} params - The parameters object
   * @param {Object} params.homey - The Homey object
   * @returns {Promise<string>} The URL to the devices file
   * @throws {ApiError} If file creation fails
   * @example
   * const fileUrl = await createDevicesFile({ homey });
   */
  async createDevicesFile({ homey }) {
    console.log('API - createDevicesFile - called');

    try {
      validateApiParams({ homey });

      const devicesPath = await saveAllDevices(homey);
      const ipAddress = homey.app.echoConnect.getIPAddress();

      if (!ipAddress) {
        throw new Error('IP address not available');
      }

      const fullPath = `http://${ipAddress}${API_CONSTANTS.APP_PATH_PREFIX}${devicesPath}`;

      console.log('API - createDevicesFile - file URL created:', fullPath);
      return fullPath;

    } catch (error) {
      console.error('API - createDevicesFile - error:', error.message);

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        ERROR_CODES.FILE_CREATION,
        `Unable to create devices file: ${error.message}`,
        error
      );
    }
  },

  /**
   * Get the server authentication status
   * @param {Object} params - The parameters object
   * @param {Object} params.homey - The Homey object
   * @returns {Promise<Object>} The server status object
   * @throws {ApiError} If status check fails
   * @example
   * const status = await getServerStatus({ homey });
   */
  async getServerStatus({ homey }) {
    console.log('API - getServerStatus - called');

    try {
      validateApiParams({ homey });

      const isAuth = await Promise.race([
        homey.app.echoConnect.isAuthenticated(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Authentication check timeout')), API_CONSTANTS.TIMEOUT_AUTH_CHECK)
        )
      ]);

      console.log(`API - getServerStatus - authentication status: ${isAuth ? 'authenticated' : 'not authenticated'}`);

      return {
        status: Boolean(isAuth),
        msg: isAuth
          ? homey.__("settings.connection.server.ok")
          : homey.__("settings.connection.server.error"),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('API - getServerStatus - error:', error.message);
      throw new ApiError(
        ERROR_CODES.SERVER_STATUS,
        `Server status check failed: ${error.message}`,
        error
      );
    }
  },

  /**
   * Get the WebSocket connection status
   * @param {Object} params - The parameters object
   * @param {Object} params.homey - The Homey object
   * @returns {Promise<Object>} The WebSocket status object
   * @throws {ApiError} If status check fails
   * @example
   * const status = await getWebSocketStatus({ homey });
   */
  async getWebSocketStatus({ homey }) {
    console.log('API - getWebSocketStatus - called');

    try {
      validateApiParams({ homey });

      const isPushConnected = homey.app.echoConnect.isPushConnected();

      console.log(`API - getWebSocketStatus - connection status: ${isPushConnected ? 'connected' : 'disconnected'}`);

      return {
        status: Boolean(isPushConnected),
        msg: isPushConnected
          ? homey.__("settings.connection.ws.ok")
          : homey.__("settings.connection.ws.error"),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('API - getWebSocketStatus - error:', error.message);
      throw new ApiError(
        ERROR_CODES.WEBSOCKET_STATUS,
        `WebSocket status check failed: ${error.message}`,
        error
      );
    }
  },

  /**
   * Disconnect from Alexa and clean up resources
   * @param {Object} params - The parameters object
   * @param {Object} params.homey - The Homey object
   * @returns {Promise<Object>} Disconnection result
   * @throws {ApiError} If disconnection fails
   * @example
   * const result = await disconnectAlexa({ homey });
   */
  async disconnectAlexa({ homey }) {
    console.log('API - disconnectAlexa - called');

    try {
      validateApiParams({ homey });

      // Stop push messages
      homey.app.echoConnect.stopPushMessage();

      // Clear authentication cookie
      homey.settings.unset('cookie');

      // Optional: Clear other related settings
      homey.settings.unset('amazonPage');

      console.log('API - disconnectAlexa - disconnection successful');

      return {
        success: true,
        message: 'Successfully disconnected from Alexa',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('API - disconnectAlexa - error:', error.message);
      throw new ApiError(
        ERROR_CODES.DISCONNECT,
        `Disconnection failed: ${error.message}`,
        error
      );
    }
  },

  /**
   * Get comprehensive system status
   * @param {Object} params - The parameters object
   * @param {Object} params.homey - The Homey object
   * @returns {Promise<Object>} Complete system status
   * @example
   * const status = await getSystemStatus({ homey });
   */
  async getSystemStatus({ homey }) {
    console.log('API - getSystemStatus - called');

    try {
      validateApiParams({ homey });

      const [serverStatus, wsStatus] = await Promise.allSettled([
        this.getServerStatus({ homey }),
        this.getWebSocketStatus({ homey })
      ]);

      return {
        server: serverStatus.status === 'fulfilled' ? serverStatus.value : {
          status: false,
          error: serverStatus.reason?.message || 'Unknown error'
        },
        websocket: wsStatus.status === 'fulfilled' ? wsStatus.value : {
          status: false,
          error: wsStatus.reason?.message || 'Unknown error'
        },
        overall: serverStatus.status === 'fulfilled' && wsStatus.status === 'fulfilled' &&
          serverStatus.value.status && wsStatus.value.status,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('API - getSystemStatus - error:', error.message);
      throw new ApiError(
        ERROR_CODES.SERVER_STATUS,
        `System status check failed: ${error.message}`,
        error
      );
    }
  },

  /**
   * Health check endpoint for monitoring
   * @param {Object} params - The parameters object
   * @param {Object} params.homey - The Homey object
   * @returns {Promise<Object>} Health check result
   * @example
   * const health = await healthCheck({ homey });
   */
  async healthCheck({ homey }) {
    console.log('API - healthCheck - called');

    try {
      validateApiParams({ homey });

      const startTime = Date.now();
      const systemStatus = await this.getSystemStatus({ homey });
      const responseTime = Date.now() - startTime;

      return {
        healthy: systemStatus.overall,
        responseTime,
        details: systemStatus,
        version: homey.app.manifest.version || 'unknown',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('API - healthCheck - error:', error.message);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
};