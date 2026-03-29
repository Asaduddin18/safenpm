/**
 * profile-builder.test.ts
 * Unit tests for buildProfile — written BEFORE implementation (TDD).
 *
 * buildProfile converts a list of Violation records (observed during a profiling
 * run) into a PackageCapability object that reflects the minimum required access.
 */

import { describe, it, expect } from 'vitest'
import { buildProfile } from '../../../src/profiler/profile-builder'
import type { Violation } from '../../../src/capabilities/schema'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeViolation(overrides: Partial<Violation>): Violation {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    severity: 'HIGH',
    package: 'test-pkg',
    packageVersion: '1.0.0',
    attempted: 'test',
    reason: 'UNAUTHORIZED_FS_READ',
    blocked: false,
    stackTrace: [],
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('buildProfile', () => {
  it('returns an all-deny profile when no violations are observed', () => {
    const profile = buildProfile('empty-pkg', '1.0.0', [])
    expect(profile.fs.read).toEqual([])
    expect(profile.fs.write).toEqual([])
    expect(profile.net.outbound).toBe(false)
    expect(profile.net.hosts).toEqual([])
    expect(profile.env).toEqual([])
    expect(profile.child_process.allowed).toBe(false)
    expect(profile.worker_threads).toBe(false)
  })

  it('adds paths from UNAUTHORIZED_FS_READ violations to fs.read', () => {
    const violations = [
      makeViolation({ reason: 'UNAUTHORIZED_FS_READ', attempted: 'readFileSync(/etc/config.json)' }),
      makeViolation({ reason: 'UNAUTHORIZED_FS_READ', attempted: 'readFileSync(/var/data/db.json)' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.fs.read).toContain('/etc/config.json')
    expect(profile.fs.read).toContain('/var/data/db.json')
  })

  it('adds paths from UNAUTHORIZED_FS_WRITE violations to fs.write', () => {
    const violations = [
      makeViolation({ reason: 'UNAUTHORIZED_FS_WRITE', attempted: 'writeFileSync(/tmp/output.log)' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.fs.write).toContain('/tmp/output.log')
  })

  it('sets net.outbound=true and adds hosts from UNAUTHORIZED_OUTBOUND_CONNECTION violations', () => {
    const violations = [
      makeViolation({ reason: 'UNAUTHORIZED_OUTBOUND_CONNECTION', attempted: 'https.request(api.example.com)' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.net.outbound).toBe(true)
    expect(profile.net.hosts).toContain('api.example.com')
  })

  it('adds env vars from UNDECLARED_ENV_ACCESS violations (non-secret only)', () => {
    const violations = [
      makeViolation({ reason: 'UNDECLARED_ENV_ACCESS', attempted: 'process.env.NODE_ENV' }),
      makeViolation({ reason: 'UNDECLARED_ENV_ACCESS', attempted: 'process.env.PORT' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.env).toContain('NODE_ENV')
    expect(profile.env).toContain('PORT')
  })

  it('does NOT add env vars from CREDENTIAL_THEFT_ATTEMPT violations', () => {
    const violations = [
      makeViolation({ reason: 'CREDENTIAL_THEFT_ATTEMPT', attempted: 'process.env.AWS_SECRET_ACCESS_KEY' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.env).not.toContain('AWS_SECRET_ACCESS_KEY')
  })

  it('sets child_process.allowed=true from UNAUTHORIZED_PROCESS_SPAWN violations', () => {
    const violations = [
      makeViolation({ reason: 'UNAUTHORIZED_PROCESS_SPAWN', attempted: 'execSync(ls)' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.child_process.allowed).toBe(true)
  })

  it('deduplicates duplicate fs paths', () => {
    const violations = [
      makeViolation({ reason: 'UNAUTHORIZED_FS_READ', attempted: 'readFileSync(/etc/config.json)' }),
      makeViolation({ reason: 'UNAUTHORIZED_FS_READ', attempted: 'readFileSync(/etc/config.json)' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.fs.read.filter(p => p === '/etc/config.json')).toHaveLength(1)
  })

  it('deduplicates duplicate net hosts', () => {
    const violations = [
      makeViolation({ reason: 'UNAUTHORIZED_OUTBOUND_CONNECTION', attempted: 'https.request(api.example.com)' }),
      makeViolation({ reason: 'UNAUTHORIZED_OUTBOUND_CONNECTION', attempted: 'https.request(api.example.com)' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.net.hosts.filter(h => h === 'api.example.com')).toHaveLength(1)
  })

  it('sets correct version, approvedBy=auto, and approvedAt in the profile', () => {
    const profile = buildProfile('my-pkg', '2.3.4', [])
    expect(profile.version).toBe('2.3.4')
    expect(profile.approvedBy).toBe('auto')
    expect(profile.approvedAt).toBeTruthy()
  })

  it('extracts hostname from attempted string with port (api.example.com:443)', () => {
    const violations = [
      makeViolation({ reason: 'UNAUTHORIZED_OUTBOUND_CONNECTION', attempted: 'net.connect(api.example.com:443)' }),
    ]
    const profile = buildProfile('test-pkg', '1.0.0', violations)
    expect(profile.net.hosts).toContain('api.example.com')
  })
})
