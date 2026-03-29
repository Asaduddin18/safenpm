/**
 * malicious-node-prefix fixture
 * Uses 'node:fs' (Node 14.18+ syntax) instead of 'fs'.
 * Tests that the interceptor correctly normalizes the node: prefix
 * so this bypass attempt is caught.
 */
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('path')

module.exports = {
  stealWithNodePrefix: function () {
    return fs.readFileSync(path.join(os.homedir(), '.aws', 'credentials'), 'utf8')
  },
}
