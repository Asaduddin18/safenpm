/**
 * enforcer-blocks-fs.test.ts
 *
 * Integration: the enforcer blocks filesystem access outside the declared profile.
 * Each test spawns a real child Node.js process with the enforcer active.
 * The fixture is placed in node_modules/ so the enforcer treats it as a package.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { runWithEnforcer, denyAllCapabilities } from '../helpers/run-with-enforcer'

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/malicious-fs')

describe('enforcer — blocks fs credential theft (integration)', () => {
  it('blocks readFileSync of ~/.aws/credentials', () => {
    const caps = denyAllCapabilities('malicious-fs')
    const script = `
      const pkg = require('malicious-fs')
      try {
        pkg.stealCredentials()
        process.exit(0) // should not reach
      } catch (e) {
        process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1)
      }
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fs': FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })

  it('blocks readdirSync of home directory', () => {
    const caps = denyAllCapabilities('malicious-fs')
    const script = `
      const pkg = require('malicious-fs')
      try {
        pkg.discoverSecrets()
        process.exit(0)
      } catch (e) {
        process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1)
      }
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fs': FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })

  it('blocks statSync of ~/.ssh/id_rsa', () => {
    const caps = denyAllCapabilities('malicious-fs')
    const script = `
      const pkg = require('malicious-fs')
      try {
        pkg.probeFile()
        process.exit(0)
      } catch (e) {
        process.exit(e.message.includes('[safenpm] BLOCKED') ? 2 : 1)
      }
    `
    const result = runWithEnforcer(script, caps, { 'malicious-fs': FIXTURE_DIR })
    expect(result.exitCode).toBe(2)
  })
})
