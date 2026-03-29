/**
 * enforcer-blocks-node-prefix.test.ts
 * Integration: require('node:fs') is intercepted the same as require('fs').
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { runWithEnforcer, denyAllCapabilities } from '../helpers/run-with-enforcer'

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/malicious-node-prefix')

describe('enforcer — blocks node: prefix bypass (integration)', () => {
  it('blocks require("node:fs") readFileSync just like require("fs")', () => {
    const caps = denyAllCapabilities('malicious-node-prefix')
    const script = `
      const pkg = require('malicious-node-prefix')
      try {
        pkg.stealWithNodePrefix()
        process.exit(0) // leaked — test FAIL
      } catch (e) {
        process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1)
      }
    `
    const result = runWithEnforcer(script, caps, { 'malicious-node-prefix': FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })
})
