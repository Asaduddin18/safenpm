/**
 * interactive-approval.test.ts
 * Unit tests for the interactive approval CLI — written BEFORE implementation (TDD).
 *
 * Tests three pure functions:
 *   parseApprovalInput  — maps raw user keystrokes to approval actions
 *   parseEditCommand    — maps edit-mode lines to structured edit commands
 *   applyEdit           — applies one edit command to a PackageCapability
 *
 * And the approval runner itself with mocked I/O.
 */

import { describe, it, expect } from 'vitest'
import {
  parseApprovalInput,
  parseEditCommand,
  applyEdit,
  resetProfile,
  runApprovalSession,
} from '../../../src/ui/interactive-approval'
import type { PackageCapability, CapabilitiesFile } from '../../../src/capabilities/schema'
import type { ApprovalIO } from '../../../src/ui/interactive-approval'

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function makeCapsFile(packages: Record<string, PackageCapability>): CapabilitiesFile {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    projectRoot: '/test',
    packages,
  }
}

/** Creates a mock ApprovalIO that plays back scripted answers in order. */
function mockIO(answers: string[]): ApprovalIO & { output: string[] } {
  const output: string[] = []
  let idx = 0
  return {
    output,
    write(text: string) { output.push(text) },
    async prompt(_question: string): Promise<string> {
      return answers[idx++] ?? 'q'
    },
  }
}

// ─── parseApprovalInput ──────────────────────────────────────────────────────

describe('parseApprovalInput', () => {
  it.each(['a', 'A', 'approve'])('"%s" returns approve', (input) => {
    expect(parseApprovalInput(input)).toBe('approve')
  })

  it.each(['e', 'E', 'edit'])('"%s" returns edit', (input) => {
    expect(parseApprovalInput(input)).toBe('edit')
  })

  it.each(['s', 'S', 'skip'])('"%s" returns skip', (input) => {
    expect(parseApprovalInput(input)).toBe('skip')
  })

  it.each(['q', 'Q', 'quit'])('"%s" returns quit', (input) => {
    expect(parseApprovalInput(input)).toBe('quit')
  })

  it.each(['', '  ', 'x', 'hello', '123'])('"%s" returns null (re-prompt)', (input) => {
    expect(parseApprovalInput(input)).toBeNull()
  })
})

// ─── parseEditCommand ────────────────────────────────────────────────────────

describe('parseEditCommand', () => {
  it('parses "fs read /tmp/**"', () => {
    const cmd = parseEditCommand('fs read /tmp/**')
    expect(cmd).toMatchObject({ type: 'add', category: 'fs.read', value: '/tmp/**' })
  })

  it('parses "fs write /var/log/**"', () => {
    const cmd = parseEditCommand('fs write /var/log/**')
    expect(cmd).toMatchObject({ type: 'add', category: 'fs.write', value: '/var/log/**' })
  })

  it('parses "net api.stripe.com"', () => {
    const cmd = parseEditCommand('net api.stripe.com')
    expect(cmd).toMatchObject({ type: 'add', category: 'net', value: 'api.stripe.com' })
  })

  it('parses "env NODE_ENV"', () => {
    const cmd = parseEditCommand('env NODE_ENV')
    expect(cmd).toMatchObject({ type: 'add', category: 'env', value: 'NODE_ENV' })
  })

  it('parses "spawn"', () => {
    const cmd = parseEditCommand('spawn')
    expect(cmd).toMatchObject({ type: 'add', category: 'spawn', value: null })
  })

  it('parses "done"', () => {
    expect(parseEditCommand('done')).toMatchObject({ type: 'action', action: 'done' })
  })

  it('parses "reset"', () => {
    expect(parseEditCommand('reset')).toMatchObject({ type: 'action', action: 'reset' })
  })

  it('parses "cancel"', () => {
    expect(parseEditCommand('cancel')).toMatchObject({ type: 'action', action: 'cancel' })
  })

  it('returns unknown for garbage input', () => {
    expect(parseEditCommand('foobar')).toMatchObject({ type: 'action', action: 'unknown' })
  })

  it('returns unknown for empty input', () => {
    expect(parseEditCommand('')).toMatchObject({ type: 'action', action: 'unknown' })
  })
})

// ─── applyEdit ───────────────────────────────────────────────────────────────

describe('applyEdit', () => {
  it('adds a path to fs.read', () => {
    const p = makeProfile()
    const updated = applyEdit(p, { type: 'add', category: 'fs.read', value: '/tmp/**' })
    expect(updated.fs.read).toContain('/tmp/**')
  })

  it('adds a path to fs.write', () => {
    const p = makeProfile()
    const updated = applyEdit(p, { type: 'add', category: 'fs.write', value: '/var/log/**' })
    expect(updated.fs.write).toContain('/var/log/**')
  })

  it('adds a host to net.hosts and sets outbound true', () => {
    const p = makeProfile()
    const updated = applyEdit(p, { type: 'add', category: 'net', value: 'api.stripe.com' })
    expect(updated.net.outbound).toBe(true)
    expect(updated.net.hosts).toContain('api.stripe.com')
  })

  it('adds an env var', () => {
    const p = makeProfile()
    const updated = applyEdit(p, { type: 'add', category: 'env', value: 'NODE_ENV' })
    expect(updated.env).toContain('NODE_ENV')
  })

  it('sets child_process.allowed true for spawn', () => {
    const p = makeProfile()
    const updated = applyEdit(p, { type: 'add', category: 'spawn', value: null })
    expect(updated.child_process.allowed).toBe(true)
  })

  it('does not duplicate fs.read paths', () => {
    const p = makeProfile({ fs: { read: ['/tmp/**'], write: [] } })
    const updated = applyEdit(p, { type: 'add', category: 'fs.read', value: '/tmp/**' })
    expect(updated.fs.read.filter(x => x === '/tmp/**')).toHaveLength(1)
  })

  it('does not duplicate net hosts', () => {
    const p = makeProfile({ net: { outbound: true, hosts: ['api.stripe.com'] } })
    const updated = applyEdit(p, { type: 'add', category: 'net', value: 'api.stripe.com' })
    expect(updated.net.hosts.filter(x => x === 'api.stripe.com')).toHaveLength(1)
  })

  it('does not duplicate env vars', () => {
    const p = makeProfile({ env: ['NODE_ENV'] })
    const updated = applyEdit(p, { type: 'add', category: 'env', value: 'NODE_ENV' })
    expect(updated.env.filter(x => x === 'NODE_ENV')).toHaveLength(1)
  })
})

// ─── resetProfile ────────────────────────────────────────────────────────────

describe('resetProfile', () => {
  it('returns an all-deny profile with the given name and version', () => {
    const p = resetProfile('my-pkg', '2.0.0')
    expect(p.version).toBe('2.0.0')
    expect(p.fs.read).toEqual([])
    expect(p.net.outbound).toBe(false)
    expect(p.env).toEqual([])
    expect(p.child_process.allowed).toBe(false)
  })
})

// ─── runApprovalSession ──────────────────────────────────────────────────────

describe('runApprovalSession', () => {
  it('approving all packages sets approvedBy to "user" for each', async () => {
    const caps = makeCapsFile({
      'pkg-a': makeProfile({ version: '1.0.0' }),
      'pkg-b': makeProfile({ version: '2.0.0' }),
    })
    const io = mockIO(['a', 'a'])  // approve both

    const result = await runApprovalSession(caps, io)

    expect(result.packages['pkg-a'].approvedBy).toBe('user')
    expect(result.packages['pkg-b'].approvedBy).toBe('user')
  })

  it('skipping a package keeps approvedBy as "auto"', async () => {
    const caps = makeCapsFile({ 'pkg-a': makeProfile() })
    const io = mockIO(['s'])  // skip

    const result = await runApprovalSession(caps, io)

    expect(result.packages['pkg-a'].approvedBy).toBe('auto')
  })

  it('quitting stops the loop — only previously approved packages are updated', async () => {
    const caps = makeCapsFile({
      'pkg-a': makeProfile(),
      'pkg-b': makeProfile(),
    })
    const io = mockIO(['a', 'q'])  // approve first, quit before second

    const result = await runApprovalSession(caps, io)

    expect(result.packages['pkg-a'].approvedBy).toBe('user')
    expect(result.packages['pkg-b'].approvedBy).toBe('auto')
  })

  it('editing then "done" approves the edited profile', async () => {
    const caps = makeCapsFile({ 'sneaky-sorter': makeProfile() })
    const io = mockIO(['e', 'net api.stripe.com', 'done'])

    const result = await runApprovalSession(caps, io)

    expect(result.packages['sneaky-sorter'].net.outbound).toBe(true)
    expect(result.packages['sneaky-sorter'].net.hosts).toContain('api.stripe.com')
    expect(result.packages['sneaky-sorter'].approvedBy).toBe('user')
  })

  it('editing then "cancel" keeps the original profile (not approved)', async () => {
    const caps = makeCapsFile({ 'my-pkg': makeProfile() })
    const io = mockIO(['e', 'net evil.io', 'cancel', 'a'])  // cancel edit, then approve original

    const result = await runApprovalSession(caps, io)

    expect(result.packages['my-pkg'].net.outbound).toBe(false)
    expect(result.packages['my-pkg'].approvedBy).toBe('user')
  })

  it('editing then "reset" clears all edits — "done" approves the clean all-deny', async () => {
    const caps = makeCapsFile({ 'my-pkg': makeProfile() })
    const io = mockIO(['e', 'net evil.io', 'reset', 'done'])

    const result = await runApprovalSession(caps, io)

    expect(result.packages['my-pkg'].net.outbound).toBe(false)
    expect(result.packages['my-pkg'].approvedBy).toBe('user')
  })

  it('invalid input is ignored and re-prompts until valid input is given', async () => {
    const caps = makeCapsFile({ 'pkg-a': makeProfile() })
    const io = mockIO(['x', '', 'garbage', 'a'])  // bad inputs then approve

    const result = await runApprovalSession(caps, io)

    expect(result.packages['pkg-a'].approvedBy).toBe('user')
  })

  it('output contains the package name during display', async () => {
    const caps = makeCapsFile({ 'sneaky-sorter': makeProfile() })
    const io = mockIO(['a'])

    await runApprovalSession(caps, io)

    const allOutput = io.output.join('\n')
    expect(allOutput).toContain('sneaky-sorter')
  })
})

// ─── parseArgs --yes flag ────────────────────────────────────────────────────

describe('parseArgs --yes flag', () => {
  it('is tested in args.test.ts (see P6.9d)', () => {
    // Intentionally minimal here — covered in dedicated args test file
    expect(true).toBe(true)
  })
})
