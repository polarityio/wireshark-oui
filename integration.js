const { setLogger } = require('./src/logger');
const { MacParser } = require('./src/mac-parser');
const path = require('path');
const ScheduledFileDownloader = require('./src/scheduled-file-downloader');

const MANUF_GZ_URL = 'https://www.wireshark.org/download/automated/data/manuf.gz';
const MANUF_FILE_PATH = path.join(__dirname, 'data', 'manuf.gz');
const FILE_UPDATE_CRON = '0 0 * * 0'; // Sunday at Midnight

let parser = null;
let fileDownloader = null;
let Logger;

async function startup(logger) {
  Logger = logger;
  setLogger(logger);
}

async function doLookup(entities, options, cb) {
  Logger.trace({ entities }, 'doLookup Entities');

  try {
    await maybeInitializeParserAndDownloader(options);
  } catch (error) {
    return cb(parseErrorToReadableJSON(error));
  }

  if (!parser) {
    return cb({
      statusCode: 500,
      detail: 'Parser not initialized'
    });
  }

  const lookupResults = [];
  for (const entity of entities) {
    const result = await parser.lookup(entity.value, true);
    if (result) {
      lookupResults.push({
        entity,
        data: {
          summary: [result.vendor],
          details: {
            oui: result
          }
        }
      });
    } else {
      lookupResults.push({ entity, data: null });
    }
  }

  Logger.trace({ lookupResults }, 'Lookup Results');

  cb(null, lookupResults);
}

function parseErrorToReadableJSON(error) {
  return JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)));
}

/**
 * Initialize the parser and file downloader if they haven't been already.
 * @param options
 * @returns {Promise<void>}
 */
async function maybeInitializeParserAndDownloader(options) {
  if (fileDownloader !== null && parser !== null) {
    // Already initialized
    return;
  }

  if (options.autoUpdate) {
    fileDownloader = new ScheduledFileDownloader({
      url: MANUF_GZ_URL,
      filePath: MANUF_FILE_PATH,
      cron: FILE_UPDATE_CRON,
      logger: Logger,
      throwErrorsOnInit: true
    });

    fileDownloader.on('updated', manufFileUpdated);
    fileDownloader.on('error', manufFileUpdateError);

    try {
      // Setup automatic downloading of the manuf file and download an initial copy if the current
      // copy is expired or missing.
      await fileDownloader.init();
    } catch (fileDownloadError) {
      Logger.error(
        { fileDownloadError: parseErrorToReadableJSON(fileDownloadError) },
        'Error initializing scheduled file downloader'
      );

      fileDownloader.removeAllListeners('updated');
      fileDownloader.removeAllListeners('error');

      throw fileDownloadError;
    }
  }

  parser = new MacParser({
    eager: false,
    manufPath: MANUF_FILE_PATH,
    logger: Logger
  });

  try {
    await parser.init();
    Logger.info('Initialized MAC Parser');
  } catch (initError) {
    Logger.error({ initError: parseErrorToReadableJSON(initError) }, 'Error initializing mac parser');
    throw initError;
  }
}

/**
 * Triggered anytime the manuf file is updated on disk by the scheduled cron job
 * which means we need to reparse the new manuf file.  The update event is not
 * triggered when the downloader is initially initialized.
 */
async function manufFileUpdated({ filePath, url, time }) {
  try {
    if (parser) {
      await parser.reinitialize();
      Logger.info('Successfully reinitialized mac parser');
    }
  } catch (parseError) {
    Logger.error(
      {
        parseError: parseErrorToReadableJSON(parseError),
        filePath,
        url,
        time
      },
      'Error reinitializing mac parser'
    );
  }
}

function manufFileUpdateError(error) {
  Logger.error({ error: parseErrorToReadableJSON(error) }, 'Error updating manuf file');
}

module.exports = {
  doLookup,
  startup
};
