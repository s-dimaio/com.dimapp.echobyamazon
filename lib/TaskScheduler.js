


class SchedulerError extends Error {
    constructor(code, text) {
      super(text);
      this.name = 'SchedulerError';
      this.code = code;
    }
  }


/**
 * A class for scheduling asynchronous tasks to run at a fixed interval.
 * @example
 * // Define an asynchronous task:
 * async function myTask() {
 *   console.log("Task is running...");
 *   await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
 *   console.log("Task finished.");
 * }
 *
 * // Create a TaskScheduler instance and start it:
 * const scheduler = new TaskScheduler(myTask, 5000); // Run every 5 seconds
 * scheduler.start();
 *
 * // Stop the scheduler after 15 seconds:
 * setTimeout(() => scheduler.stop(), 15000);
 */
class TaskScheduler {
    /**
     * Creates a new TaskScheduler instance.
     * @param {function} homey The Homey object.
     * @param {function} task The asynchronous function to execute.
     * @param {number} [interval=3600000] The interval between task executions in milliseconds (default: 1 hour).
     * @throws {Error} If the task is not a function.
     * @example
     * const scheduler = new TaskScheduler(async () => console.log("Task running"), 60000); // Run every minute
     */
    constructor(homey, task, interval = 60 * 60 * 1000, showLog = false) {
        if (typeof task !== 'function') {
            throw new Error('The task must be a function.');
        }
        this.homey = homey;
        this.task = task;
        this.interval = interval;
        this.timer = null;
        this.isRunning = false;
        this.showLog = showLog;
    }

      /**
   * Logs messages to the console if logging is enabled.
   * @private
   * @param {...any} args - The arguments to log.
   * @example
   * log('This is a debug message');
   */
  _log(...args) {
    if (this.showLog) {
      const timestamp = new Date().toISOString();
      const message = args.join(' ');
      console.log(`%c${timestamp}`, 'color: green', `[TASK-SCHEDULER] - ${message}`);
    }
  }

    /**
     * Executes the scheduled task. This method is called internally.
     * @private
     * @async
     * @example
     * const scheduler = new TaskScheduler(async () => console.log("Task running"), 60000);
     * // Normally you wouldn't call executeTask directly, but for testing:
     * // scheduler.executeTask();
     */
    async _executeTask() {
        if (this.isRunning) {
            console.warn("Task is still running, skipping this iteration.");
            return;
        }

        this.isRunning = true;
        this._log("Task execution started.");

        try {
            await this.task();
            this._log("Task execution completed.");
        } catch (error) {
            console.error("Error during task execution:", error);
        } finally {
            this.isRunning = false;
            this.timer = this.homey.setTimeout(() => this._executeTask(), this.interval);
        }
    }

    /**
     * Starts the task scheduler.
     * @example
     * const scheduler = new TaskScheduler(async () => console.log("Task running"), 60000);
     * scheduler.start(); // Start the scheduler
     */
    start() {
        if (this.timer) {
            console.warn("Task scheduler is already running.");
            return;
        }
        this._log("Task scheduler started.");
        //this._executeTask(); // Execute the task immediately on start
        this.timer = this.homey.setTimeout(() => this._executeTask(), this.interval); // Delay the first execution by the interval

    }

    /**
     * Stops the task scheduler.
     * @example
     * const scheduler = new TaskScheduler(async () => console.log("Task running"), 60000);
     * scheduler.start();
     * setTimeout(() => scheduler.stop(), 10000); // Stop after 10 seconds
     */
    stop() {
        if (this.timer) {
            this.homey.clearTimeout(this.timer);
            this.timer = null;
            this.isRunning = false;
            this._log("Task scheduler stopped.");
        }
    }

    /**
     * Updates the interval between task executions.
     * @param {number} newInterval The new interval in milliseconds.
     * @throws {SchedulerError} If the new interval is not a positive number.
     * @example
     * const scheduler = new TaskScheduler(async () => console.log("Task running"), 60000);
     * scheduler.start();
     * scheduler.setInterval(30000); // Change interval to 30 seconds
     */
    setInterval(newInterval) {
        if (typeof newInterval !== 'number' || newInterval <= 0) {
            throw new SchedulerError('ERROR_SET_INTERVAL','The interval must be a positive number.');
        }
        this.interval = newInterval;
        this._log(`Task interval updated to ${newInterval} milliseconds.`);
        if (this.timer) {
            this.stop();
            this.start();
        }
    }
}

module.exports = {
    TaskScheduler,
    SchedulerError
  };