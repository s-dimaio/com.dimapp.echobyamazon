'use strict';

/**
 * sync-local-lib.js
 *
 * Copies the source files from the local alexa-remote library workspace into
 * node_modules/alexa-remote2 without modifying package.json or package-lock.json.
 * This allows local development without using npm link (which can cause
 * module resolution issues).
 *
 * Usage (via npm scripts):
 *   npm run run:local    - sync + homey app run
 *   npm run run:github   - npm install + homey app run (uses the GitHub version)
 *
 * @module dev-scripts/sync-local-lib
 */

const fs = require('fs');
const path = require('path');

// Configuration

/**
 * Absolute path to the local alexa-remote workspace.
 * @type {string}
 */
const LOCAL_LIB_SRC = 'D:\\Workspace\\VSCode\\alexa-remote';

/** 
 * Absolute path to the alexa-remote2 folder inside node_modules.
 * @type {string}
 */
const LOCAL_LIB_DEST = path.resolve(__dirname, '..', 'node_modules', 'alexa-remote2');

/**
 * Files and directories to copy from the source workspace.
 * @type {string[]}
 */
const ITEMS_TO_COPY = [
  'alexa-remote.js',
  'alexa-remote.d.ts',
  'alexa-http2push.js',
  'alexa-wsmqtt.js',
  'package.json',
];

// Helpers

/**
 * Recursively copies a directory from src to dest.
 * 
 * @private
 * @method _copyDir
 * @param {string} src - The absolute path to the source directory (mandatory).
 * @param {string} dest - The absolute path to the destination directory (mandatory).
 * @returns {void}
 * @example
 * _copyDir('D:\\Workspace\\VSCode\\alexa-remote\\example', 'D:\\Workspace\\Homey\\com.dimapp.echobyamazon\\node_modules\\alexa-remote2\\example');
 */
function _copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      _copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copies a single item (file or directory) from src to dest.
 * 
 * @private
 * @method _copyItem
 * @param {string} name - The relative name of the item to copy (relative to LOCAL_LIB_SRC) (mandatory).
 * @returns {void}
 * @example
 * _copyItem('alexa-remote.js');
 */
function _copyItem(name) {
  const srcPath = path.join(LOCAL_LIB_SRC, name);
  const destPath = path.join(LOCAL_LIB_DEST, name);

  if (!fs.existsSync(srcPath)) {
    console.warn('  Warning - Source not found, skipping: ' + srcPath);
    return;
  }

  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    _copyDir(srcPath, destPath);
  } else {
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(srcPath, destPath);
  }

  console.log('  OK  ' + name);
}

// Main

console.log('');
console.log('sync-local-lib - Syncing local alexa-remote -> node_modules/alexa-remote2');
console.log('   Source : ' + LOCAL_LIB_SRC);
console.log('   Dest   : ' + LOCAL_LIB_DEST);
console.log('');

if (LOCAL_LIB_SRC === 'YOUR_LOCAL_PATH_TO_ALEXA_REMOTE' || !fs.existsSync(LOCAL_LIB_SRC)) {
  console.error('\x1b[31m%s\x1b[0m', '❌ ERROR: Local alexa-remote source path not found or not configured.');
  console.error('\x1b[31m%s\x1b[0m', '   To fix this and use local development:');
  console.error('\x1b[31m%s\x1b[0m', '   1. Open dev-scripts/sync-local-lib.js');
  console.error('\x1b[31m%s\x1b[0m', '   2. Update the LOCAL_LIB_SRC constant to the absolute local path on your PC of alexa-remote library.');
  console.error('\x1b[31m%s\x1b[0m', '   Otherwise, run "npm run run:github" to run using the GitHub version.');
  console.log('');
  process.exit(1);
}

if (!fs.existsSync(LOCAL_LIB_DEST)) {
  console.error('ERROR: node_modules/alexa-remote2 not found at: ' + LOCAL_LIB_DEST);
  console.error('Run "npm run run:github" first to install the original package, then retry.');
  process.exit(1);
}

for (const item of ITEMS_TO_COPY) {
  _copyItem(item);
}

console.log('');
console.log('Sync complete - starting Homey app...');
console.log('');
