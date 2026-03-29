/**
 * net-shim.test.ts
 *
 * Tests for src/enforcer/shims/net.shim.ts
 *
 * Covers: outbound blocked, specific host blocked, wildcard matching,
 * exact match, null profile behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNetShim } from '../../src/enforcer/shims/net.shim'
import type { PackageCapability, Violation } from '../../src/capabilities/schema'

const noNetProfile: PackageCapability = {
  version: '1.0.0',
  fs: { read: [], write: [] },
  net: { outbound: false, hosts: [] },
  env: [],
  child_process: { allowed: false },
  worker_threads: false,
  hasNativeModules: false,
  approvedBy: 'user',
  approvedAt: '2026-01-01T00:00:00Z',
}

const smtpOnlyProfile: PackageCapability = {
  ...noNetProfile,
  net: { outbound: true, hosts: ['smtp.gmail.com', 'smtp.sendgrid.net'] },
}

const wildcardProfile: PackageCapability = {
  ...noNetProfile,
  net: { outbound: true, hosts: ['*.github.com'] },
}

const anyHostProfile: PackageCapability = {
  ...noNetProfile,
  net: { outbound: true, hosts: ['*'] },
}

function makeMockNet(): { connect: ReturnType<typeof vi.fn>; createConnection: ReturnType<typeof vi.fn> } {
  return {
    connect: vi.fn().mockReturnValue({ on: vi.fn() }),
    createConnection: vi.fn().mockReturnValue({ on: vi.fn() }),
  }
}

describe('net shim — outbound completely blocked', () => {
  let violations: Violation[]
  let mockNet: ReturnType<typeof makeMockNet>
  let shim: ReturnType<typeof makeMockNet>

  beforeEach(() => {
    violations = []
    mockNet = makeMockNet()
    shim = createNetShim(mockNet, noNetProfile, 'lodash', v => violations.push(v)) as typeof mockNet
  })

  it('connect() throws when outbound: false', () => {
    expect(() => shim.connect({ host: 'evil.com', port: 443 })).toThrow('[safenpm] BLOCKED')
  })

  it('real connect() is NOT called when blocked', () => {
    try { shim.connect({ host: 'evil.com', port: 443 }) } catch { /* expected */ }
    expect(mockNet.connect).not.toHaveBeenCalled()
  })

  it('violation has HIGH severity and correct reason', () => {
    try { shim.connect({ host: 'evil.com', port: 443 }) } catch { /* expected */ }
    expect(violations[0].severity).toBe('HIGH')
    expect(violations[0].reason).toBe('UNAUTHORIZED_OUTBOUND_CONNECTION')
    expect(violations[0].blocked).toBe(true)
    expect(violations[0].package).toBe('lodash')
  })

  it('createConnection() also blocked', () => {
    expect(() => shim.createConnection({ host: 'example.com', port: 80 })).toThrow('[safenpm] BLOCKED')
    expect(mockNet.createConnection).not.toHaveBeenCalled()
  })

  it('handles host as positional string argument', () => {
    expect(() => shim.connect(443, 'evil.com')).toThrow('[safenpm] BLOCKED')
  })
})

describe('net shim — specific host allowlist', () => {
  let violations: Violation[]
  let mockNet: ReturnType<typeof makeMockNet>
  let shim: ReturnType<typeof makeMockNet>

  beforeEach(() => {
    violations = []
    mockNet = makeMockNet()
    shim = createNetShim(mockNet, smtpOnlyProfile, 'nodemailer', v => violations.push(v)) as typeof mockNet
  })

  it('allows connection to whitelisted host', () => {
    shim.connect({ host: 'smtp.gmail.com', port: 587 })
    expect(mockNet.connect).toHaveBeenCalled()
    expect(violations).toHaveLength(0)
  })

  it('blocks connection to non-whitelisted host with CRITICAL severity', () => {
    expect(() => shim.connect({ host: 'evil.exfil.io', port: 443 })).toThrow('[safenpm] BLOCKED')
    expect(violations[0].severity).toBe('CRITICAL')
    expect(violations[0].reason).toBe('CONNECTION_TO_UNAUTHORIZED_HOST')
  })

  it('allows second whitelisted host', () => {
    shim.connect({ host: 'smtp.sendgrid.net', port: 587 })
    expect(mockNet.connect).toHaveBeenCalled()
    expect(violations).toHaveLength(0)
  })
})

describe('net shim — wildcard host matching', () => {
  let violations: Violation[]
  let mockNet: ReturnType<typeof makeMockNet>
  let shim: ReturnType<typeof makeMockNet>

  beforeEach(() => {
    violations = []
    mockNet = makeMockNet()
    shim = createNetShim(mockNet, wildcardProfile, 'octokit', v => violations.push(v)) as typeof mockNet
  })

  it('allows subdomain matching wildcard pattern *.github.com', () => {
    shim.connect({ host: 'api.github.com', port: 443 })
    expect(mockNet.connect).toHaveBeenCalled()
    expect(violations).toHaveLength(0)
  })

  it('allows another subdomain matching wildcard', () => {
    shim.connect({ host: 'uploads.github.com', port: 443 })
    expect(mockNet.connect).toHaveBeenCalled()
    expect(violations).toHaveLength(0)
  })

  it('blocks domain that does not match wildcard', () => {
    expect(() => shim.connect({ host: 'evil.com', port: 443 })).toThrow('[safenpm] BLOCKED')
  })

  it('blocks the bare domain (github.com) when only *.github.com is allowed', () => {
    // *.github.com should NOT match github.com itself
    expect(() => shim.connect({ host: 'github.com', port: 443 })).toThrow('[safenpm] BLOCKED')
  })
})

describe('net shim — wildcard * allows any host', () => {
  it('allows any host when hosts: ["*"]', () => {
    const mockNet = makeMockNet()
    const shim = createNetShim(mockNet, anyHostProfile, 'http-client', vi.fn()) as typeof mockNet
    shim.connect({ host: 'anything.com', port: 80 })
    expect(mockNet.connect).toHaveBeenCalled()
  })
})

describe('net shim — null profile', () => {
  it('blocks all outbound connections for unregistered package', () => {
    const mockNet = makeMockNet()
    const violations: Violation[] = []
    const shim = createNetShim(mockNet, null, 'unknown-pkg', v => violations.push(v)) as typeof mockNet
    expect(() => shim.connect({ host: 'example.com', port: 80 })).toThrow('[safenpm] BLOCKED')
    expect(violations[0].reason).toBe('NO_CAPABILITY_PROFILE')
  })
})
