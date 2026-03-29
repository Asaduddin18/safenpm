/**
 * enforcer-blocks-spawn.test.ts
 * Integration: enforcer blocks unauthorized child process spawning.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { runWithEnforcer, denyAllCapabilities } from '../helpers/run-with-enforcer'

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/malicious-spawn')

describe('enforcer — blocks process spawning (integration)', () => {
  it('blocks execSync of shell command', () => {
    const caps = denyAllCapabilities('malicious-spawn')
    const script = `
      const pkg = require('malicious-spawn')
      try {
        pkg.stealViaShell()
        process.exit(0)
      } catch (e) {
        process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1)
      }
    `
    const result = runWithEnforcer(script, caps, { 'malicious-spawn': FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })

  it('blocks spawn() of shell process', () => {
    const caps = denyAllCapabilities('malicious-spawn')
    const script = `
      const pkg = require('malicious-spawn')
      try {
        pkg.spawnShell()
        process.exit(0)
      } catch (e) {
        process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1)
      }
    `
    const result = runWithEnforcer(script, caps, { 'malicious-spawn': FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })
})
