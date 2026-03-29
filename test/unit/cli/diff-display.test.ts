/**
 * diff-display.test.ts
 * Unit tests for diffProfiles — written BEFORE implementation (TDD).
 *
 * diffProfiles(oldProfile, newProfile) returns a structured diff showing
 * what capability changes occurred between two versions of a package.
 */

import { describe, it, expect } from 'vitest'
import { diffProfiles } from '../../../src/ui/diff-display'
import type { PackageCapability } from '../../../src/capabilities/schema'

function makeProfile(overrides: Partial<PackageCapability> = {}): PackageCapability {
  return {
    version: '1.0.0',
    fs: { read: [], write: [] },
    net: { outbound: false, hosts: [] },
    env: [],
    child_process: { allowed: false },
    worker_threads: false,
    hasNativeModules: false,
    approvedBy: 'auto',
    approvedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('diffProfiles', () => {
  it('returns empty diff for identical profiles', () => {
    const p = makeProfile()
    const diff = diffProfiles(p, p)
    expect(diff.fsReadAdded).toEqual([])
    expect(diff.fsReadRemoved).toEqual([])
    expect(diff.netHostsAdded).toEqual([])
    expect(diff.netHostsRemoved).toEqual([])
    expect(diff.envAdded).toEqual([])
    expect(diff.envRemoved).toEqual([])
    expect(diff.hasChanges).toBe(false)
  })

  it('detects new fs read paths', () => {
    const old = makeProfile({ fs: { read: ['/etc/a'], write: [] } })
    const next = makeProfile({ fs: { read: ['/etc/a', '/etc/b'], write: [] } })
    const diff = diffProfiles(old, next)
    expect(diff.fsReadAdded).toContain('/etc/b')
    expect(diff.fsReadRemoved).toEqual([])
    expect(diff.hasChanges).toBe(true)
  })

  it('detects removed fs read paths', () => {
    const old = makeProfile({ fs: { read: ['/etc/a', '/etc/b'], write: [] } })
    const next = makeProfile({ fs: { read: ['/etc/a'], write: [] } })
    const diff = diffProfiles(old, next)
    expect(diff.fsReadRemoved).toContain('/etc/b')
    expect(diff.fsReadAdded).toEqual([])
  })

  it('detects new fs write paths', () => {
    const old = makeProfile()
    const next = makeProfile({ fs: { read: [], write: ['/tmp/out'] } })
    const diff = diffProfiles(old, next)
    expect(diff.fsWriteAdded).toContain('/tmp/out')
  })

  it('detects removed fs write paths', () => {
    const old = makeProfile({ fs: { read: [], write: ['/tmp/out'] } })
    const next = makeProfile()
    const diff = diffProfiles(old, next)
    expect(diff.fsWriteRemoved).toContain('/tmp/out')
  })

  it('detects newly added net hosts', () => {
    const old = makeProfile()
    const next = makeProfile({ net: { outbound: true, hosts: ['evil.io'] } })
    const diff = diffProfiles(old, next)
    expect(diff.netHostsAdded).toContain('evil.io')
  })

  it('detects removed net hosts', () => {
    const old = makeProfile({ net: { outbound: true, hosts: ['api.safe.com'] } })
    const next = makeProfile({ net: { outbound: true, hosts: [] } })
    const diff = diffProfiles(old, next)
    expect(diff.netHostsRemoved).toContain('api.safe.com')
  })

  it('detects net outbound changing from false to true', () => {
    const old = makeProfile()
    const next = makeProfile({ net: { outbound: true, hosts: [] } })
    const diff = diffProfiles(old, next)
    expect(diff.netOutboundChanged).toBe(true)
    expect(diff.hasChanges).toBe(true)
  })

  it('detects newly declared env vars', () => {
    const old = makeProfile({ env: ['NODE_ENV'] })
    const next = makeProfile({ env: ['NODE_ENV', 'PORT'] })
    const diff = diffProfiles(old, next)
    expect(diff.envAdded).toContain('PORT')
  })

  it('detects removed env vars', () => {
    const old = makeProfile({ env: ['NODE_ENV', 'PORT'] })
    const next = makeProfile({ env: ['NODE_ENV'] })
    const diff = diffProfiles(old, next)
    expect(diff.envRemoved).toContain('PORT')
  })

  it('detects child_process.allowed changing to true', () => {
    const old = makeProfile()
    const next = makeProfile({ child_process: { allowed: true } })
    const diff = diffProfiles(old, next)
    expect(diff.spawnChanged).toBe(true)
    expect(diff.hasChanges).toBe(true)
  })

  it('detects hasNativeModules changing to true', () => {
    const old = makeProfile({ hasNativeModules: false })
    const next = makeProfile({ hasNativeModules: true })
    const diff = diffProfiles(old, next)
    expect(diff.nativeModulesChanged).toBe(true)
    expect(diff.hasChanges).toBe(true)
  })
})
