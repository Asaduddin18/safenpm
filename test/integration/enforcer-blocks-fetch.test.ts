/**
 * enforcer-blocks-fetch.test.ts
 *
 * Integration tests: enforcer blocks unauthorized fetch() calls (Node 18+ global).
 *
 * These tests prove that globalThis.fetch is intercepted even though
 * the package never calls require('http') or require('https').
 * The fetch shim is the only thing standing between the package and the network.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { runWithEnforcer, denyAllCapabilities } from '../helpers/run-with-enforcer'
import type { CapabilitiesFile } from '../../src/capabilities/schema'

const FETCH_FIXTURE_DIR = path.resolve(__dirname, '../fixtures/malicious-fetch')

// ─── capability builders ──────────────────────────────────────────────────────

function netAllowedCapabilities(packageName: string, hosts: string[]): CapabilitiesFile {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    projectRoot: '/test',
    packages: {
      [packageName]: {
        version: '1.0.0',
        fs: { read: [], write: [] },
        net: { outbound: true, hosts },
        env: [],
        child_process: { allowed: false },
        worker_threads: false,
        hasNativeModules: false,
        approvedBy: 'user',
        approvedAt: new Date().toISOString(),
      },
    },
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('enforcer — blocks global fetch() exfiltration (integration)', () => {
  it('blocks fetch when package has no net permission', () => {
    const caps = denyAllCapabilities('malicious-fetch')
    const script = `
      const pkg = require('malicious-fetch')
      pkg.exfiltrate('stolen-data')
        .then(() => process.exit(1))
        .catch(e => process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1))
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fetch': FETCH_FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })

  it('blocks fetch when outbound is true but host is not in allowlist', () => {
    const caps = netAllowedCapabilities('malicious-fetch', ['api.safe.io'])
    const script = `
      const pkg = require('malicious-fetch')
      // evil.exfil.io is NOT in the allowlist — should be blocked
      pkg.exfiltrate('stolen-data')
        .then(() => process.exit(1))
        .catch(e => process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1))
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fetch': FETCH_FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })

  it('blocks fetch with URL object input when host is unauthorized', () => {
    const caps = denyAllCapabilities('malicious-fetch')
    const script = `
      const pkg = require('malicious-fetch')
      pkg.exfiltrateWithUrlObject('stolen-data')
        .then(() => process.exit(1))
        .catch(e => process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1))
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fetch': FETCH_FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })

  it('allows fetch when the host is explicitly in the allowlist', () => {
    // Allow api.allowed.io — the sendToAllowedHost function targets that host
    const caps = netAllowedCapabilities('malicious-fetch', ['api.allowed.io'])
    const script = `
      const pkg = require('malicious-fetch')
      // Mock globalThis.fetch so we don't make real network calls in tests
      // (the shim allows it; the mock prevents actual HTTP)
      const original = globalThis.fetch
      globalThis.fetch = () => Promise.resolve(new Response('ok'))
      pkg.sendToAllowedHost('data')
        .then(() => { globalThis.fetch = original; process.exit(2) })
        .catch(e => { globalThis.fetch = original; process.exit(1) })
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fetch': FETCH_FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })

  it('allows fetch with wildcard host permission', () => {
    const caps = netAllowedCapabilities('malicious-fetch', ['*'])
    const script = `
      const pkg = require('malicious-fetch')
      const original = globalThis.fetch
      globalThis.fetch = () => Promise.resolve(new Response('ok'))
      pkg.exfiltrate('data')
        .then(() => { globalThis.fetch = original; process.exit(2) })
        .catch(e => { globalThis.fetch = original; process.exit(1) })
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fetch': FETCH_FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })

  it('violation is written to stderr when fetch is blocked', () => {
    const caps = denyAllCapabilities('malicious-fetch')
    const script = `
      const pkg = require('malicious-fetch')
      pkg.exfiltrate('stolen')
        .then(() => process.exit(1))
        .catch(() => process.exit(2))
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fetch': FETCH_FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('[safenpm')
  })
})
