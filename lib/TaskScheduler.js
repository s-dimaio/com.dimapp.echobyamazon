


'use strict';

// Constants for better maintainability
const ERROR_CODES = {
  INVALID_TASK: 'ERROR_INVALID_TASK',
  INVALID_INTERVAL: 'ERROR_INVALID_INTERVAL',
  INVALID_HOMEY_OBJECT: 'ERROR_INVALID_HOMEY_OBJECT',
  TASK_EXECUTION: 'ERROR_TASK_EXECUTION'
};

const DEFAULT_VALUES = {
  INTERVAL: 60 * 60 * 1000, // 1 hour in milliseconds
  SHOW_LOG: false,
  MIN_INTERVAL: 1000 // Minimum 1 second interval
};

const LOG_COLORS = {
  INFO: 'color: blue',
  WARN: 'color: orange',
  ERROR: 'color: red'
};

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
class TaskScheduler {    /**
     * Creates a new TaskScheduler instance.
     * @param {Object} homey - The Homey object for managing timers
     * @param {Function} task - The asynchronous function to execute
     * @param {number} [interval=3600000] - The interval between task executions in milliseconds (default: 1 hour)
     * @param {boolean} [showLog=false] - Whether to show debug logs
     * @throws {SchedulerError} If parameters are invalid
     * @example
     * const scheduler = new TaskScheduler(homey, async () => console.log("Task running"), 60000); // Run every minute
     */
    constructor(homey, task, interval = DEFAULT_VALUES.INTERVAL, showLog = DEFAULT_VALUES.SHOW_LOG) {
        // Validate Homey object
        if (!homey || typeof homey.setTimeout !== 'function' || typeof homey.clearTimeout !== 'function') {
            throw new SchedulerError(ERROR_CODES.INVALID_HOMEY_OBJECT, 'Invalid Homey object provided. Must have setTimeout and clearTimeout methods.');
        }

        // Validate task function
        if (typeof task !== 'function') {
            throw new SchedulerError(ERROR_CODES.INVALID_TASK, 'The task must be a function.');
        }

        // Validate interval
        if (typeof interval !== 'number' || interval < DEFAULT_VALUES.MIN_INTERVAL) {
            throw new SchedulerError(ERROR_CODES.INVALID_INTERVAL, `The interval must be a number >= ${DEFAULT_VALUES.MIN_INTERVAL} milliseconds.`);
        }

        this.homey = homey;
        this.task = task;
        this.interval = interval;
        this.timer = null;
        this.isRunning = false;
        this.showLog = Boolean(showLog);
        this.taskCount = 0; // Track number of executions
        this.lastExecution = null; // Track last execution time
        this.errors = []; // Track recent errors (max 10)
    }    /**
     * Enhanced logging with different levels
     * @private
     * @param {string} level - Log level (INFO, WARN, ERROR)
     * @param {...any} args - The arguments to log
     */
    _log(level = 'INFO', ...args) {
        if (!this.showLog) return;

        const timestamp = new Date().toISOString();
        const color = LOG_COLORS[level] || LOG_COLORS.INFO;
        
        console.log(`%c${timestamp}`, color, `[TASK-SCHEDULER-${level}]`, ...args);
    }

    /**
     * Log info messages
     * @private
     * @param {...any} args - The arguments to log
     */
    _logInfo(...args) {
        this._log('INFO', ...args);
    }

    /**
     * Log warning messages
     * @private
     * @param {...any} args - The arguments to log
     */
    _logWarn(...args) {
        this._log('WARN', ...args);
    }

    /**
     * Log error messages
     * @private
     * @param {...any} args - The arguments to log
     */
    _logError(...args) {
        this._log('ERROR', ...args);
    }    /**
     * Executes the scheduled task with improved error handling and statistics
     * @private
     * @async
     */
    async _executeTask() {
        if (this.isRunning) {
            this._logWarn("Task is still running, skipping this iteration.");
            return;
        }

        this.isRunning = true;
        this.lastExecution = new Date();
        this._logInfo(`Task execution #${this.taskCount + 1} started.`);

        const startTime = Date.now();

        try {
            await this.task();
            
            const executionTime = Date.now() - startTime;
            this.taskCount++;
            this._logInfo(`Task execution #${this.taskCount} completed in ${executionTime}ms.`);
            
        } catch (error) {
            this._handleTaskError(error);
        } finally {
            this.isRunning = false;
            this._scheduleNextExecution();
        }
    }

    /**
     * Handle task execution errors with tracking
     * @private
     * @param {Error} error - The error that occurred
     */
    _handleTaskError(error) {
        this._logError("Error during task execution:", error.message);
        
        // Track errors (keep only last 10)
        const errorInfo = {
            timestamp: new Date(),
            message: error.message,
            stack: error.stack
        };
        
        this.errors.push(errorInfo);
        if (this.errors.length > 10) {
            this.errors.shift();
        }

        // Emit error event if Homey object supports events
        if (typeof this.homey.emit === 'function') {
            this.homey.emit('taskSchedulerError', {
                error: errorInfo,
                scheduler: this.getStats()
            });
        }
    }

    /**
     * Schedule the next task execution
     * @private
     */
    _scheduleNextExecution() {
        if (this.timer === null) {
            // Scheduler was stopped during task execution
            return;
        }

        this.timer = this.homey.setTimeout(() => this._executeTask(), this.interval);
    }    /**
     * Starts the task scheduler with options
     * @param {Object} [options={}] - Start options
     * @param {boolean} [options.immediate=false] - Execute task immediately on start
     * @param {boolean} [options.reset=false] - Reset statistics on start
     * @example
     * const scheduler = new TaskScheduler(homey, async () => console.log("Task running"), 60000);
     * scheduler.start(); // Start the scheduler
     * scheduler.start({ immediate: true }); // Start and execute immediately
     */
    start(options = {}) {
        const { immediate = false, reset = false } = options;

        if (this.timer) {
            this._logWarn("Task scheduler is already running.");
            return;
        }

        if (reset) {
            this.resetStats();
        }

        this._logInfo(`Task scheduler started with interval: ${this.interval}ms`);

        if (immediate) {
            // Execute immediately, then schedule next
            this._executeTask();
        } else {
            // Schedule first execution after interval
            this.timer = this.homey.setTimeout(() => this._executeTask(), this.interval);
        }
    }    /**
     * Stops the task scheduler and cleans up resources
     * @param {Object} [options={}] - Stop options
     * @param {boolean} [options.waitForCurrent=false] - Wait for current task to finish
     * @example
     * const scheduler = new TaskScheduler(homey, async () => console.log("Task running"), 60000);
     * scheduler.start();
     * setTimeout(() => scheduler.stop(), 10000); // Stop after 10 seconds
     */
    async stop(options = {}) {
        const { waitForCurrent = false } = options;

        if (!this.timer && !this.isRunning) {
            this._logWarn("Task scheduler is not running.");
            return;
        }

        // Clear the timer to prevent new executions
        if (this.timer) {
            this.homey.clearTimeout(this.timer);
            this.timer = null;
        }

        // Wait for current task if requested
        if (waitForCurrent && this.isRunning) {
            this._logInfo("Waiting for current task to complete...");
            
            // Poll until task is finished (with timeout)
            const maxWait = Math.max(this.interval, 30000); // Max 30 seconds
            const startWait = Date.now();
            
            while (this.isRunning && (Date.now() - startWait) < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (this.isRunning) {
                this._logWarn("Timeout waiting for current task to complete.");
            }
        }

        this.isRunning = false;
        this._logInfo("Task scheduler stopped.");
    }    /**
     * Updates the interval between task executions
     * @param {number} newInterval - The new interval in milliseconds
     * @param {Object} [options={}] - Update options  
     * @param {boolean} [options.restart=true] - Whether to restart if currently running
     * @throws {SchedulerError} If the new interval is invalid
     * @example
     * const scheduler = new TaskScheduler(homey, async () => console.log("Task running"), 60000);
     * scheduler.start();
     * scheduler.setInterval(30000); // Change interval to 30 seconds
     */
    setInterval(newInterval, options = {}) {
        const { restart = true } = options;

        if (typeof newInterval !== 'number' || newInterval < DEFAULT_VALUES.MIN_INTERVAL) {
            throw new SchedulerError(
                ERROR_CODES.INVALID_INTERVAL, 
                `The interval must be a number >= ${DEFAULT_VALUES.MIN_INTERVAL} milliseconds.`
            );
        }

        const oldInterval = this.interval;
        this.interval = newInterval;
        
        this._logInfo(`Task interval updated from ${oldInterval}ms to ${newInterval}ms.`);

        if (this.timer && restart) {
            this.stop();
            this.start();
        }
    }

    /**
     * Get scheduler statistics
     * @returns {Object} Statistics object
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            hasActiveTimer: this.timer !== null,
            interval: this.interval,
            taskCount: this.taskCount,
            lastExecution: this.lastExecution,
            recentErrors: this.errors.slice(-5), // Last 5 errors
            uptime: this.taskCount > 0 && this.lastExecution ? Date.now() - this.lastExecution.getTime() : 0
        };
    }

    /**
     * Get the next scheduled execution time
     * @returns {Date|null} Next execution time or null if not scheduled
     */
    getNextExecution() {
        if (!this.timer || !this.lastExecution) {
            return null;
        }
        
        return new Date(this.lastExecution.getTime() + this.interval);
    }

    /**
     * Check if the scheduler is healthy (no recent errors)
     * @returns {boolean} True if healthy
     */
    isHealthy() {
        const recentErrors = this.errors.filter(error => 
            Date.now() - error.timestamp.getTime() < this.interval * 2
        );
        
        return recentErrors.length === 0;
    }

    /**
     * Reset error tracking and statistics
     */
    resetStats() {
        this.taskCount = 0;
        this.lastExecution = null;
        this.errors = [];
        this._logInfo("Scheduler statistics reset.");
    }

    /**
     * Validate the current scheduler configuration
     * @throws {SchedulerError} If configuration is invalid
     */
    validate() {
        if (!this.homey || typeof this.homey.setTimeout !== 'function') {
            throw new SchedulerError(ERROR_CODES.INVALID_HOMEY_OBJECT, 'Invalid Homey object.');
        }

        if (typeof this.task !== 'function') {
            throw new SchedulerError(ERROR_CODES.INVALID_TASK, 'Invalid task function.');
        }

        if (typeof this.interval !== 'number' || this.interval < DEFAULT_VALUES.MIN_INTERVAL) {
            throw new SchedulerError(ERROR_CODES.INVALID_INTERVAL, 'Invalid interval value.');
        }

        return true;
    }
}

module.exports = {
    TaskScheduler,
    SchedulerError
};