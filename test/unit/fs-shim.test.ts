/**
 * fs-shim.test.ts
 *
 * Tests for src/enforcer/shims/fs.shim.ts
 *
 * Every test verifies THREE things:
 *  1. The shim THROWS when the path is outside the allowed list
 *  2. The REAL fs function is NOT called when blocked (credentials never read)
 *  3. The violation handler IS called with the correct severity and reason
 *  4. The real fs function IS called when the path is within allowed list
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'
import { createFsShim } from '../../src/enforcer/shims/fs.shim'
import type { PackageCapability, Violation } from '../../src/capabilities/schema'

// A profile that allows nothing
const noAccessProfile: PackageCapability = {
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

// A profile that allows /tmp reads and writes
const tmpAccessProfile: PackageCapability = {
  ...noAccessProfile,
  fs: { read: ['/tmp/**'], write: ['/tmp/**'] },
}

function makeMockFs(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    readFile: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('file-contents'),
    createReadStream: vi.fn().mockReturnValue({ on: vi.fn() }),
    open: vi.fn(),
    openSync: vi.fn().mockReturnValue(3),
    read: vi.fn(),
    readSync: vi.fn().mockReturnValue(0),
    readdir: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    readlink: vi.fn(),
    readlinkSync: vi.fn().mockReturnValue(''),
    stat: vi.fn(),
    statSync: vi.fn().mockReturnValue({}),
    lstat: vi.fn(),
    lstatSync: vi.fn().mockReturnValue({}),
    access: vi.fn(),
    accessSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    watch: vi.fn(),
    watchFile: vi.fn(),
    writeFile: vi.fn(),
    writeFileSync: vi.fn(),
    createWriteStream: vi.fn().mockReturnValue({ write: vi.fn(), end: vi.fn() }),
    appendFile: vi.fn(),
    appendFileSync: vi.fn(),
    unlink: vi.fn(),
    unlinkSync: vi.fn(),
    mkdir: vi.fn(),
    mkdirSync: vi.fn(),
    rmdir: vi.fn(),
    rmdirSync: vi.fn(),
    rm: vi.fn(),
    rmSync: vi.fn(),
    rename: vi.fn(),
    renameSync: vi.fn(),
    copyFile: vi.fn(),
    copyFileSync: vi.fn(),
    chmod: vi.fn(),
    chmodSync: vi.fn(),
    chown: vi.fn(),
    chownSync: vi.fn(),
    truncate: vi.fn(),
    truncateSync: vi.fn(),
    symlink: vi.fn(),
    symlinkSync: vi.fn(),
  }
}

describe('fs shim — read operations BLOCKED when no read permission', () => {
  let mockFs: ReturnType<typeof makeMockFs>
  let violations: Violation[]
  let shim: ReturnType<typeof makeMockFs>

  beforeEach(() => {
    mockFs = makeMockFs()
    violations = []
    shim = createFsShim(mockFs, noAccessProfile, 'evil-pkg', v => violations.push(v)) as typeof mockFs
  })

  const credPath = path.join(os.homedir(), '.aws', 'credentials')

  it('readFileSync — throws on blocked path', () => {
    expect(() => shim.readFileSync(credPath)).toThrow('[safenpm] BLOCKED')
  })

  it('readFileSync — does NOT call real fs when blocked', () => {
    try { shim.readFileSync(credPath) } catch { /* expected */ }
    expect(mockFs.readFileSync).not.toHaveBeenCalled()
  })

  it('readFileSync — calls violation handler with CRITICAL severity', () => {
    try { shim.readFileSync(credPath) } catch { /* expected */ }
    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('CRITICAL')
    expect(violations[0].reason).toBe('CREDENTIAL_THEFT_ATTEMPT')
    expect(violations[0].blocked).toBe(true)
    expect(violations[0].package).toBe('evil-pkg')
  })

  it('readFileSync — HIGH severity for non-sensitive unauthorized path', () => {
    try { shim.readFileSync('/var/log/syslog') } catch { /* expected */ }
    expect(violations[0].severity).toBe('HIGH')
    expect(violations[0].reason).toBe('UNAUTHORIZED_FS_READ')
  })

  it('readdir — throws on blocked path', () => {
    expect(() => shim.readdirSync(os.homedir())).toThrow('[safenpm] BLOCKED')
    expect(mockFs.readdirSync).not.toHaveBeenCalled()
  })

  it('statSync — throws on blocked sensitive path', () => {
    expect(() => shim.statSync(credPath)).toThrow('[safenpm] BLOCKED')
    expect(mockFs.statSync).not.toHaveBeenCalled()
  })

  it('existsSync — throws on blocked sensitive path', () => {
    expect(() => shim.existsSync(credPath)).toThrow('[safenpm] BLOCKED')
    expect(mockFs.existsSync).not.toHaveBeenCalled()
  })

  it('createReadStream — throws on blocked path', () => {
    expect(() => shim.createReadStream(credPath)).toThrow('[safenpm] BLOCKED')
    expect(mockFs.createReadStream).not.toHaveBeenCalled()
  })

  it('lstatSync — throws on blocked path', () => {
    expect(() => shim.lstatSync(credPath)).toThrow('[safenpm] BLOCKED')
    expect(mockFs.lstatSync).not.toHaveBeenCalled()
  })

  it('accessSync — throws on blocked path', () => {
    expect(() => shim.accessSync(credPath)).toThrow('[safenpm] BLOCKED')
    expect(mockFs.accessSync).not.toHaveBeenCalled()
  })
})

describe('fs shim — write operations BLOCKED when no write permission', () => {
  let mockFs: ReturnType<typeof makeMockFs>
  let violations: Violation[]
  let shim: ReturnType<typeof makeMockFs>

  beforeEach(() => {
    mockFs = makeMockFs()
    violations = []
    shim = createFsShim(mockFs, noAccessProfile, 'evil-pkg', v => violations.push(v)) as typeof mockFs
  })

  it('writeFileSync — throws and does not call real fs', () => {
    expect(() => shim.writeFileSync('/etc/crontab', 'evil')).toThrow('[safenpm] BLOCKED')
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('writeFileSync — calls violation handler with HIGH severity', () => {
    try { shim.writeFileSync('/etc/crontab', 'evil') } catch { /* expected */ }
    expect(violations[0].severity).toBe('HIGH')
    expect(violations[0].reason).toBe('UNAUTHORIZED_FS_WRITE')
    expect(violations[0].blocked).toBe(true)
  })

  it('unlinkSync — blocked (cannot delete files)', () => {
    expect(() => shim.unlinkSync('/important/file')).toThrow('[safenpm] BLOCKED')
    expect(mockFs.unlinkSync).not.toHaveBeenCalled()
  })

  it('mkdirSync — blocked', () => {
    expect(() => shim.mkdirSync('/new/dir')).toThrow('[safenpm] BLOCKED')
    expect(mockFs.mkdirSync).not.toHaveBeenCalled()
  })

  it('renameSync — blocked', () => {
    expect(() => shim.renameSync('/a', '/b')).toThrow('[safenpm] BLOCKED')
    expect(mockFs.renameSync).not.toHaveBeenCalled()
  })

  it('copyFileSync — blocked', () => {
    expect(() => shim.copyFileSync('/src', '/dst')).toThrow('[safenpm] BLOCKED')
    expect(mockFs.copyFileSync).not.toHaveBeenCalled()
  })
})

describe('fs shim — ALLOWED operations pass through to real fs', () => {
  let mockFs: ReturnType<typeof makeMockFs>
  let violations: Violation[]
  let shim: ReturnType<typeof makeMockFs>

  beforeEach(() => {
    mockFs = makeMockFs()
    violations = []
    shim = createFsShim(mockFs, tmpAccessProfile, 'good-pkg', v => violations.push(v)) as typeof mockFs
  })

  it('readFileSync on allowed path calls real fs and returns value', () => {
    const result = shim.readFileSync('/tmp/output.txt')
    expect(mockFs.readFileSync).toHaveBeenCalledWith('/tmp/output.txt')
    expect(result).toBe('file-contents')
    expect(violations).toHaveLength(0)
  })

  it('writeFileSync on allowed path calls real fs', () => {
    shim.writeFileSync('/tmp/output.txt', 'data')
    expect(mockFs.writeFileSync).toHaveBeenCalledWith('/tmp/output.txt', 'data')
    expect(violations).toHaveLength(0)
  })

  it('readdirSync on allowed path passes through', () => {
    shim.readdirSync('/tmp')
    expect(mockFs.readdirSync).toHaveBeenCalledWith('/tmp')
    expect(violations).toHaveLength(0)
  })

  it('allowed path does not add to violations', () => {
    shim.readFileSync('/tmp/safe.txt')
    expect(violations).toHaveLength(0)
  })
})

describe('fs shim — null profile (package not registered)', () => {
  it('blocks everything and uses NO_CAPABILITY_PROFILE reason', () => {
    const mockFs = makeMockFs()
    const violations: Violation[] = []
    const shim = createFsShim(mockFs, null, 'unknown-pkg', v => violations.push(v))

    expect(() => (shim as typeof mockFs).readFileSync('/tmp/file')).toThrow('[safenpm] BLOCKED')
    expect(violations[0].reason).toBe('NO_CAPABILITY_PROFILE')
  })
})

describe('fs shim — non-intercepted methods pass through unchanged', () => {
  it('methods not in read/write lists pass through directly', () => {
    const mockFs = makeMockFs()
    ;(mockFs as Record<string, unknown>).someCustomMethod = vi.fn().mockReturnValue('ok')
    const shim = createFsShim(mockFs, noAccessProfile, 'pkg', vi.fn())
    // @ts-expect-error — accessing non-standard method for test
    expect(shim.someCustomMethod()).toBe('ok')
  })
})
