/**
 * enforcer-blocks-dynamic-require.test.ts
 * Hardening P5.1: dynamic require(variable) must still be intercepted.
 *
 * A naive shim might only intercept literal require('fs') calls.
 * Module._load intercepts ALL require() calls — static or dynamic —
 * so this test verifies that dynamic patterns are not a bypass vector.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { runWithEnforcer, denyAllCapabilities } from '../helpers/run-with-enforcer'

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/malicious-fs')

describe('enforcer — blocks dynamic require (hardening)', () => {
  it('blocks require(variable) where variable === "fs"', () => {
    const caps = denyAllCapabilities('malicious-fs')
    const script = `
      const pkg = require('malicious-fs')
      // The package internally uses: const mod = 'fs'; require(mod)
      // This tests that dynamic requires are also intercepted
      try {
        pkg.dynamicRequireFs()
        process.exit(0) // not blocked — FAIL
      } catch (e) {
        process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1)
      }
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fs': FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })
})
