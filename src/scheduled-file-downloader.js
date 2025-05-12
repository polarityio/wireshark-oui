/**
 * ScheduledFileDownloader
 *
 * Events
 *   • updated → { filePath, url, time }
 *   • error   → { error, stage, url }
 *
 * Constructor options
 *   • url                – remote HTTP(S) URL               (required)
 *   • filePath           – destination path on disk         (required)
 *   • cron               – cron expression (node-schedule)  (default '0 0 * * *')
 *   • throwErrorsOnInit  – throw vs. emit during init       (default false)
 *   • logger             – Bunyan-style logger (optional)
 *
 */

const { EventEmitter } = require('events');
const { writeFile, stat, mkdir, rename } = require('fs').promises;
const { dirname } = require('path');
const util = require('util');
const schedule = require('node-schedule');
const { CronExpressionParser } = require('cron-parser');
const request = require('postman-request');
const requestAsync = util.promisify(request);

class ScheduledFileDownloader extends EventEmitter {
  /**
   * @param {Object}  opts
   * @param {string}  opts.url
   * @param {string}  opts.filePath
   * @param {string} [opts.cron='0 0 * * *']
   * @param {boolean}[opts.throwErrorsOnInit=false]
   * @param {Object} [opts.logger]  Bunyan-style logger (info/warn/error/debug)
   */
  constructor({ url, filePath, cron = '0 0 * * *', throwErrorsOnInit = false, logger } = {}) {
    super();
    if (!url || !filePath) throw new Error('"url" and "filePath" are required');

    // Bunyan-style logger or console shim (keeps {obj}, msg signature)
    this.logger = logger || {
      info: (o, m) => console.info(m, o),
      warn: (o, m) => console.warn(m, o),
      error: (o, m) => console.error(m, o),
      debug: (o, m) => console.debug(m, o)
    };

    this.url = url;
    this.filePath = filePath;
    this.cron = cron;
    this.throwErrorsOnInit = !!throwErrorsOnInit;
    this.job = null;
  }

  /* ───────────── public ───────────── */

  /**
   * Initialize the downloader. Update event is not emitted on init.
   * @returns {Promise<void>}
   */
  async init() {
    let expired;
    try {
      expired = await this._isExpired();
    } catch (err) {
      if (this.throwErrorsOnInit) throw err;
      this.logger.error({ err }, 'Failed during init/expiration check');
      this.emit('error', { error: err, stage: 'init', url: this.url });
      expired = true; // still attempt first download
    }

    if (expired) {
      try {
        await this._downloadFile({ emitErrors: !this.throwErrorsOnInit, emitUpdate: false });
      } catch (err) {
        if (this.throwErrorsOnInit) throw err; // otherwise already handled
      }
    }

    this._scheduleRecurringJob();
    this.logger.info({ cron: this.cron }, 'Scheduled recurring download job');
  }

  /* ───────────── private helpers ───────────── */

  /** True if the file is missing or older than the last cron tick. */
  async _isExpired() {
    let mtime;
    try {
      ({ mtime } = await stat(this.filePath));
    } catch (err) {
      if (err.code === 'ENOENT') return true; // file not present yet
      throw err; // other FS error
    }

    const lastDue = CronExpressionParser.parse(this.cron, { currentDate: new Date() }).prev().toDate();

    return mtime < lastDue;
  }

  /**
   * Download and atomically replace the file.
   * @param {Object}  [opts]
   * @param {boolean} [opts.emitErrors=true]  suppress event emission if false
   */
  async _downloadFile({ emitErrors = true, emitUpdate = true } = {}) {
    this.logger.debug({ url: this.url }, 'Downloading file');
    /* 1. Network download ---------------------------------------------- */
    let body;
    try {
      const { statusCode, body: buf } = await requestAsync({
        url: this.url,
        method: 'GET',
        encoding: null, // Buffer
        gzip: true
      });
      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`HTTP ${statusCode} from ${this.url}`);
      }
      body = buf;
    } catch (err) {
      if (emitErrors) this.emit('error', { error: err, stage: 'download', url: this.url });
      this.logger.error({ err }, 'Download failed');
      throw err;
    }

    /* 2. Write to disk -------------------------------------------------- */
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp-${Date.now()}`;
      await writeFile(tmp, body);
      await rename(tmp, this.filePath);
    } catch (err) {
      if (emitErrors) this.emit('error', { error: err, stage: 'write', url: this.url });
      this.logger.error({ err }, 'Failed writing file to disk');
      throw err;
    }

    /* 3. Success -------------------------------------------------------- */
    const now = new Date();
    this.logger.info({ filePath: this.filePath }, 'File downloaded successfully');
    this.emit('updated', { filePath: this.filePath, url: this.url, time: now });
  }

  /** Set up the recurring cron job. */
  _scheduleRecurringJob() {
    if (this.job) this.job.cancel();
    this.job = schedule.scheduleJob(this.cron, async () => {
      try {
        await this._downloadFile(); // emitErrors defaults to true
      } catch {
        /* already logged & emitted */
      }
    });
  }
}

module.exports = ScheduledFileDownloader;
