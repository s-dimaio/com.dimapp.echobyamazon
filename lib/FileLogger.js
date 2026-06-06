'use strict';

const fs = require('fs');

/**
 * FileLogger - Sistema di logging persistente per debug
 * Salva i log in /userdata/echo_debug.log con rotazione automatica
 */
class FileLogger {
  constructor(homey, options = {}) {
    this.homey = homey;
    this.logFile = '/userdata/echo_debug.log';
    this.maxFileSize = options.maxFileSize || 500 * 1024; // 500KB default
    this.maxBackups = options.maxBackups || 2;
    this.writeQueue = [];
    this.isWriting = false;
    this.flushInterval = null;
    
    // Statistiche per logging aggregato
    this.stats = {
      infos: 0,
      warnings: 0,
      errors: 0,
      sessionStart: new Date().toISOString()
    };
    
    // Avvia flush periodico ogni 5 minuti
    this.flushInterval = homey.setInterval(() => this._flushQueue(), 5 * 60 * 1000);
    
    // Log statistiche ogni 12 ore
    this.statsInterval = homey.setInterval(() => this._logHourlyStats(), 12 * 60 * 60 * 1000);
    
    // If requested, delete existing log files before starting a new session
    this.clearOnStart = !!options.clearOnStart;
    if (this.clearOnStart) {
      this.deleteLog().catch(err => {
        console.error('FileLogger clearOnStart error:', err);
      });
    }

    this._initLogFile();

    // Log memoria SUBITO all'avvio (baseline immediata)
    this._logMemoryUsage();

    // Monitoraggio memoria ogni 24 ore
    this.memoryInterval = homey.setInterval(() => this._logMemoryUsage(), 24 * 60 * 60 * 1000);
  }

  /**
   * Inizializza il file di log con header di sessione
   */
  _initLogFile() {
    const header = [
      '',
      '='.repeat(60),
      `SESSION START: ${new Date().toISOString()}`,
      `Homey Version: ${this.homey.version || 'unknown'}`,
      `App Version: ${this.homey.manifest?.version || 'unknown'}`,
      '='.repeat(60),
      ''
    ].join('\n');
    
    this._appendToFile(header);
  }

  /**
   * Formatta timestamp in formato leggibile
   */
  _timestamp() {
    return new Date().toISOString();
  }

  /**
   * Aggiunge alla coda di scrittura
   */
  _queueWrite(message) {
    this.writeQueue.push(message);
    
    // Flush immediato se la coda è grande
    if (this.writeQueue.length > 50) {
      this._flushQueue();
    }
  }

  /**
   * Scrive la coda su file
   */
  async _flushQueue() {
    if (this.isWriting || this.writeQueue.length === 0) return;
    
    this.isWriting = true;
    const messages = this.writeQueue.splice(0, this.writeQueue.length);
    
    try {
      await this._appendToFile(messages.join('\n') + '\n');
    } catch (error) {
      console.error('FileLogger flush error:', error);
    } finally {
      this.isWriting = false;
    }
  }

  /**
   * Appende testo al file con gestione rotazione
   */
  async _appendToFile(text) {
    try {
      // Controlla dimensione file e ruota se necessario
      await this._rotateIfNeeded();
      
      // Scrivi su file
      fs.appendFileSync(this.logFile, text);
    } catch (error) {
      console.error('FileLogger write error:', error);
    }
  }

  /**
   * Ruota i file di log se superano la dimensione massima
   */
  async _rotateIfNeeded() {
    try {
      if (!fs.existsSync(this.logFile)) return;
      
      const stats = fs.statSync(this.logFile);
      if (stats.size < this.maxFileSize) return;
      
      // Ruota i backup
      for (let i = this.maxBackups - 1; i >= 1; i--) {
        const oldFile = `${this.logFile}.${i}`;
        const newFile = `${this.logFile}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          if (i === this.maxBackups - 1) {
            fs.unlinkSync(oldFile); // Elimina il più vecchio
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      
      // Rinomina il file corrente
      fs.renameSync(this.logFile, `${this.logFile}.1`);
      
      this._queueWrite(`[${this._timestamp()}] [SYSTEM] Log rotated - new file started`);
    } catch (error) {
      console.error('FileLogger rotation error:', error);
    }
  }

  /**
   * Log statistiche orarie (riduce volume log)
   */
  _logHourlyStats() {
    const uptime = Math.round((Date.now() - new Date(this.stats.sessionStart).getTime()) / 1000 / 60);
    
    const statsMsg = [
      `[${this._timestamp()}] [STATS] Hourly Report:`,
      `  - Uptime: ${uptime} minutes`,
      `  - Info logs: ${this.stats.infos}`,
      `  - Warnings: ${this.stats.warnings}`,
      `  - Errors: ${this.stats.errors}`
    ].join('\n');
    
    this._queueWrite(statsMsg);
    
    // Reset contatori
    this.stats.infos = 0;
    this.stats.warnings = 0;
    this.stats.errors = 0;
  }

  /**
   * Log uso memoria (ogni ora)
   * Usa v8.getHeapStatistics() che è affidabile su Homey
   */
  _logMemoryUsage() {
    try {
      this.info('MEMORY-DEBUG', 'Memory check triggered');
      
      // Homey non supporta process.memoryUsage() completo
      // Usa solo heap statistics che sono disponibili
      const v8 = require('v8');
      const heapStats = v8.getHeapStatistics();
      const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

      const memMsg = [
        `[${this._timestamp()}] [MEMORY] Heap Usage Report:`,
        `  - Total Heap Size: ${formatMB(heapStats.total_heap_size)} MB`,
        `  - Used Heap Size: ${formatMB(heapStats.used_heap_size)} MB`,
        `  - Heap Size Limit: ${formatMB(heapStats.heap_size_limit)} MB`,
        `  - Available Heap: ${formatMB(heapStats.heap_size_limit - heapStats.used_heap_size)} MB`,
        `  - Usage: ${((heapStats.used_heap_size / heapStats.heap_size_limit) * 100).toFixed(1)}%`
      ].join('\n');

      this._queueWrite(memMsg);
      
      // Forza flush immediato per verificare che venga scritto
      this._flushQueue();

      // Warning se heap used supera 70% del limite
      const usagePercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;
      if (usagePercent > 70) {
        this.warn('MEMORY', `High heap usage: ${usagePercent.toFixed(1)}% (${formatMB(heapStats.used_heap_size)} MB / ${formatMB(heapStats.heap_size_limit)} MB)`);
      }

    } catch (error) {
      this.error('MEMORY', `Failed to check memory: ${error.message}`);
      console.error('FileLogger memory check error:', error);
    }
  }

  // ==================== PUBLIC LOGGING METHODS ====================

  /**
   * Log evento critico (sempre salvato su file)
   */
  error(component, message, details = null) {
    this.stats.errors++;
    const logMsg = `[${this._timestamp()}] [ERROR] [${component}] ${message}${details ? ' | ' + JSON.stringify(details) : ''}`;
    this._queueWrite(logMsg);
  }

  /**
   * Log warning (sempre salvato su file)
   */
  warn(component, message, details = null) {
    this.stats.warnings++;
    const logMsg = `[${this._timestamp()}] [WARN] [${component}] ${message}${details ? ' | ' + JSON.stringify(details) : ''}`;
    this._queueWrite(logMsg);
  }

  /**
   * Log info importante (eventi di stato, solo su file)
   */
  info(component, message, details = null) {
    this.stats.infos++;
    const logMsg = `[${this._timestamp()}] [INFO] [${component}] ${message}${details ? ' | ' + JSON.stringify(details) : ''}`;
    this._queueWrite(logMsg);
  }

  /**
   * Log debug (solo console, non su file per risparmiare spazio)
   */
  debug(component, message) {
    console.log(`[${this._timestamp()}] [DEBUG] [${component}] ${message}`);
  }

  /**
   * Log cambio di stato connessione
   */
  logConnectionStateChange(oldState, newState, reason = '') {
    this.info('CONNECTION', `State changed: ${oldState} -> ${newState}`, { reason });
  }

  /**
   * Log problema di performance
   */
  logPerformanceIssue(operation, durationMs, threshold) {
    if (durationMs > threshold) {
      this.warn('PERFORMANCE', `${operation} took ${durationMs}ms (threshold: ${threshold}ms)`);
    }
  }

  /**
   * Log quando scheduler si blocca
   */
  logSchedulerStuck(iterations) {
    this.error('SCHEDULER', `Task appears stuck after ${iterations} iterations`);
  }

  /**
   * Scrive messaggio personalizzato importante
   */
  logEvent(eventName, data = {}) {
    this.info('EVENT', eventName, data);
  }

  /**
   * Forza flush immediato (utile prima di crash/stop)
   */
  async flush() {
    await this._flushQueue();
  }

  /**
   * Cleanup risorse
   */
  async destroy() {
    // Log finale
    this._logHourlyStats();
    this._queueWrite(`[${this._timestamp()}] [SYSTEM] Logger shutting down`);
    
    // Flush finale
    await this._flushQueue();
    
    // Clear intervals
    if (this.flushInterval) {
      this.homey.clearInterval(this.flushInterval);
    }
    if (this.statsInterval) {
      this.homey.clearInterval(this.statsInterval);
    }
    if (this.memoryInterval) {
      this.homey.clearInterval(this.memoryInterval);
    }
  }

  /**
   * Legge gli ultimi N righe del log (per debug remoto)
   */
  async getLastLines(n = 100) {
    try {
      if (!fs.existsSync(this.logFile)) {
        return 'Log file not found';
      }
      
      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.split('\n');
      return lines.slice(-n).join('\n');
    } catch (error) {
      return `Error reading log: ${error.message}`;
    }
  }

  /**
   * Cancella il file di log principale e i backup
   */
  async deleteLog() {
    try {
      // Cancella file principale
      if (fs.existsSync(this.logFile)) {
        fs.unlinkSync(this.logFile);
      }
      // Cancella i backup
      for (let i = 1; i <= this.maxBackups; i++) {
        const backupFile = `${this.logFile}.${i}`;
        if (fs.existsSync(backupFile)) {
          fs.unlinkSync(backupFile);
        }
      }
      this._queueWrite(`[${this._timestamp()}] [SYSTEM] Log file deleted`);
    } catch (error) {
      this._queueWrite(`[${this._timestamp()}] [ERROR] Failed to delete log file: ${error.message}`);
    }
  }
}

module.exports = FileLogger;
