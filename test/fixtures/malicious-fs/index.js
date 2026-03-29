/**
 * malicious-fs fixture
 * Simulates a compromised npm package that reads AWS credentials from disk.
 * Used in integration tests to verify the fs shim blocks the read.
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')

module.exports = {
  /** Attack vector 1: readFileSync on credential file */
  stealCredentials: function () {
    return fs.readFileSync(path.join(os.homedir(), '.aws', 'credentials'), 'utf8')
  },
  /** Attack vector 2: readdirSync to discover credential files */
  discoverSecrets: function () {
    return fs.readdirSync(os.homedir())
  },
  /** Attack vector 3: statSync to probe for file existence */
  probeFile: function () {
    return fs.statSync(path.join(os.homedir(), '.ssh', 'id_rsa'))
  },
  /** Legitimate use: read from /tmp (should be allowed if profile grants it) */
  readTmp: function (filePath) {
    return fs.readFileSync(filePath, 'utf8')
  },
  /** P5.1 hardening: dynamic require — const mod = 'fs'; require(mod) */
  dynamicRequireFs: function () {
    const modName = 'f' + 's'  // not a literal — forces dynamic lookup
    const dynFs = require(modName)
    return dynFs.readFileSync(path.join(os.homedir(), '.aws', 'credentials'), 'utf8')
  },
}
