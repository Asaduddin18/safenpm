/**
 * capabilities-diff.test.ts
 * Integration P5.4: loading old + new profiles and computing the diff
 * correctly identifies what changed between package versions.
 */

import { describe, it, expect } from 'vitest'
import { diffProfiles } from '../../src/ui/diff-display'
import type { PackageCapability } from '../../src/capabilities/schema'

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
    approvedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('capabilities diff (integration)', () => {
  it('detects that a new version added net access (security-relevant upgrade)', () => {
    const v1 = makeProfile({ version: '1.0.0' })
    const v2 = makeProfile({
      version: '2.0.0',
      net: { outbound: true, hosts: ['telemetry.vendor.com'] },
    })

    const diff = diffProfiles(v1, v2)
    expect(diff.hasChanges).toBe(true)
    expect(diff.netOutboundChanged).toBe(true)
    expect(diff.netHostsAdded).toContain('telemetry.vendor.com')
  })

  it('detects that a new version dropped previously needed fs access', () => {
    const v1 = makeProfile({ fs: { read: ['/etc/ssl/certs'], write: [] } })
    const v2 = makeProfile({ fs: { read: [], write: [] } })

    const diff = diffProfiles(v1, v2)
    expect(diff.hasChanges).toBe(true)
    expect(diff.fsReadRemoved).toContain('/etc/ssl/certs')
    expect(diff.fsReadAdded).toEqual([])
  })

  it('detects that a new version added spawn capability (escalation)', () => {
    const v1 = makeProfile()
    const v2 = makeProfile({ child_process: { allowed: true } })

    const diff = diffProfiles(v1, v2)
    expect(diff.spawnChanged).toBe(true)
    expect(diff.hasChanges).toBe(true)
  })

  it('shows no changes when package is re-installed at same version with same profile', () => {
    const profile = makeProfile({
      version: '3.2.1',
      net: { outbound: true, hosts: ['api.stripe.com'] },
      env: ['STRIPE_KEY'],
    })

    const diff = diffProfiles(profile, profile)
    expect(diff.hasChanges).toBe(false)
  })

  it('detects native module added in a new version (major security concern)', () => {
    const v1 = makeProfile({ hasNativeModules: false })
    const v2 = makeProfile({ hasNativeModules: true })

    const diff = diffProfiles(v1, v2)
    expect(diff.nativeModulesChanged).toBe(true)
    expect(diff.hasChanges).toBe(true)
  })
})
