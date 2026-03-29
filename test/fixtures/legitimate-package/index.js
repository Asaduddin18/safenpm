/**
 * legitimate-package fixture
 * A well-behaved package that only accesses what it declared in its profile.
 * Used in integration tests to verify legitimate access is NOT blocked.
 * Profile grants: fs.read ['/tmp/**'], fs.write ['/tmp/**'], net: none, env: ['NODE_ENV']
 */
'use strict'
const fs = require('fs')
const path = require('path')

module.exports = {
  /** Legitimate: read from /tmp (declared in profile) */
  readFromTmp: function (filename) {
    return fs.readFileSync(path.join('/tmp', filename), 'utf8')
  },
  /** Legitimate: write to /tmp (declared in profile) */
  writeToTmp: function (filename, content) {
    fs.writeFileSync(path.join('/tmp', filename), content, 'utf8')
  },
  /** Legitimate: check NODE_ENV (declared in profile) */
  getEnv: function () {
    return process.env.NODE_ENV
  },
}
