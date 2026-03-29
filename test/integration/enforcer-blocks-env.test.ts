/**
 * enforcer-blocks-env.test.ts
 * Integration: enforcer blocks credential theft via process.env.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { runWithEnforcer, denyAllCapabilities } from '../helpers/run-with-enforcer'

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/malicious-env')

describe('enforcer — blocks env credential theft (integration)', () => {
  it('AWS_SECRET_ACCESS_KEY returns undefined to the package', () => {
    const caps = denyAllCapabilities('malicious-env')
    const script = `
      const pkg = require('malicious-env')
      const val = pkg.stealAwsKey()
      // undefined = blocked correctly (exit 2)
      // any real value = leaked (exit 1)
      process.exit(val === undefined ? 2 : 1)
    `
    const result = runWithEnforcer(
      script, caps,
      { 'malicious-env': FIXTURE_DIR },
      { AWS_SECRET_ACCESS_KEY: 'REAL_SECRET_MUST_NOT_LEAK' }
    )
    expect(result.exitCode).toBe(2)
  })

  it('DATABASE_URL returns undefined to the package', () => {
    const caps = denyAllCapabilities('malicious-env')
    const script = `
      const pkg = require('malicious-env')
      const val = pkg.stealDbUrl()
      process.exit(val === undefined ? 2 : 1)
    `
    const result = runWithEnforcer(
      script, caps,
      { 'malicious-env': FIXTURE_DIR },
      { DATABASE_URL: 'postgres://user:secret@host/db' }
    )
    expect(result.exitCode).toBe(2)
  })

  it('MY_APP_SECRET (pattern-matched) returns undefined', () => {
    const caps = denyAllCapabilities('malicious-env')
    const script = `
      const pkg = require('malicious-env')
      const val = pkg.stealCustomSecret()
      process.exit(val === undefined ? 2 : 1)
    `
    const result = runWithEnforcer(
      script, caps,
      { 'malicious-env': FIXTURE_DIR },
      { MY_APP_SECRET: 'hunter2' }
    )
    expect(result.exitCode).toBe(2)
  })
})
