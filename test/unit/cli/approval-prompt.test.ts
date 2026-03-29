/**
 * approval-prompt.test.ts
 * Unit tests for formatProfile — written BEFORE implementation (TDD).
 *
 * formatProfile() produces a human-readable summary of a package's
 * capability profile for display in the terminal approval UI.
 */

import { describe, it, expect } from 'vitest'
import { formatProfile } from '../../../src/ui/approval-prompt'
import type { PackageCapability } from '../../../src/capabilities/schema'

function makeProfile(overrides: Partial<PackageCapability> = {}): PackageCapability {
  return {
    version: '1.2.3',
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

describe('formatProfile', () => {
  it('includes the package name in the output', () => {
    const output = formatProfile('express', makeProfile())
    expect(output).toContain('express')
  })

  it('includes the package version', () => {
    const output = formatProfile('express', makeProfile({ version: '4.18.2' }))
    expect(output).toContain('4.18.2')
  })

  it('shows fs read paths when present', () => {
    const output = formatProfile('pkg', makeProfile({ fs: { read: ['/etc/config'], write: [] } }))
    expect(output).toContain('/etc/config')
  })

  it('shows fs write paths when present', () => {
    const output = formatProfile('pkg', makeProfile({ fs: { read: [], write: ['/tmp/output'] } }))
    expect(output).toContain('/tmp/output')
  })

  it('shows "No filesystem access" when fs is empty', () => {
    const output = formatProfile('pkg', makeProfile())
    expect(output).toContain('No filesystem access')
  })

  it('shows net hosts when net.outbound is true', () => {
    const output = formatProfile('pkg', makeProfile({
      net: { outbound: true, hosts: ['api.example.com'] }
    }))
    expect(output).toContain('api.example.com')
  })

  it('shows "No network access" when net.outbound is false', () => {
    const output = formatProfile('pkg', makeProfile())
    expect(output).toContain('No network access')
  })

  it('shows declared env vars when present', () => {
    const output = formatProfile('pkg', makeProfile({ env: ['NODE_ENV', 'PORT'] }))
    expect(output).toContain('NODE_ENV')
    expect(output).toContain('PORT')
  })

  it('shows "No env access" when env is empty', () => {
    const output = formatProfile('pkg', makeProfile())
    expect(output).toContain('No env access')
  })

  it('shows a native module warning when hasNativeModules is true', () => {
    const output = formatProfile('pkg', makeProfile({ hasNativeModules: true }))
    expect(output.toLowerCase()).toContain('native')
  })

  it('does NOT show native module warning when hasNativeModules is false', () => {
    const output = formatProfile('pkg', makeProfile({ hasNativeModules: false }))
    expect(output.toLowerCase()).not.toContain('native module')
  })

  it('shows child_process=allowed when permitted', () => {
    const output = formatProfile('pkg', makeProfile({ child_process: { allowed: true } }))
    expect(output).toContain('spawn')
  })

  it('shows "No process spawning" when child_process is blocked', () => {
    const output = formatProfile('pkg', makeProfile())
    expect(output.toLowerCase()).toContain('no process')
  })
})
