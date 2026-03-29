/**
 * enforcer-blocks-scoped-package.test.ts
 * Hardening P5.3: scoped packages (@scope/name) must be identified and blocked.
 *
 * The caller-resolver must handle paths like:
 *   /tmp/dir/node_modules/@aws-sdk/client-s3/index.js
 * and extract the package name as '@aws-sdk/client-s3'.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { runWithEnforcer, denyAllCapabilities } from '../helpers/run-with-enforcer'

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/malicious-fs')

describe('enforcer — blocks scoped packages (hardening)', () => {
  it('correctly identifies and blocks @scope/pkg from accessing credentials', () => {
    const caps = denyAllCapabilities('@malicious-scope/evil-pkg')
    const script = `
      const pkg = require('@malicious-scope/evil-pkg')
      try {
        pkg.stealCredentials()
        process.exit(0) // not blocked — FAIL
      } catch (e) {
        process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1)
      }
    `
    // Map the scoped package name to the malicious-fs fixture directory
    const result = runWithEnforcer(
      script,
      caps,
      { '@malicious-scope/evil-pkg': FIXTURE_DIR }
    )
    expect(result.exitCode).toBe(2)
  })
})
