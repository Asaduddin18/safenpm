/**
 * interactive-approval.ts
 *
 * Interactive terminal UI for reviewing and approving per-package
 * capability profiles during `safenpm install`.
 *
 * Design decisions:
 *  - All I/O goes through the injectable `ApprovalIO` interface so every
 *    code path is unit-testable without spawning real readline sessions.
 *  - Pure helper functions (parseApprovalInput, parseEditCommand, applyEdit)
 *    have zero side-effects and are exported for direct unit testing.
 *  - `runApprovalSession` is the single entry point; the caller owns the
 *    readline lifecycle (create before call, close after).
 *
 * Terminal flow per package:
 *
 *   ══════════════════════════════════════════
 *   [1 / 3]  sneaky-sorter  v1.0.0
 *   ══════════════════════════════════════════
 *     Filesystem : No filesystem access
 *     Network    : No network access
 *     ...
 *
 *   [A]pprove  [E]dit  [S]kip  [Q]uit
 *   >
 *
 * Edit sub-flow:
 *   > fs read /tmp/**
 *   > net api.stripe.com
 *   > done            ← approves the edited profile
 *   > cancel          ← discards edits, returns to main prompt
 *   > reset           ← wipes all edits back to all-deny
 */

import readline from 'readline'
import type { CapabilitiesFile, PackageCapability } from '../capabilities/schema'
import { formatProfile } from './approval-prompt'
import { buildProfile } from '../profiler/profile-builder'

// ─── Public types ─────────────────────────────────────────────────────────────

export type ApprovalAction = 'approve' | 'edit' | 'skip' | 'quit'

export interface AddEditCommand {
  type: 'add'
  category: 'fs.read' | 'fs.write' | 'net' | 'env' | 'spawn'
  value: string | null
}

export interface ActionEditCommand {
  type: 'action'
  action: 'done' | 'reset' | 'cancel' | 'unknown'
}

export type EditCommand = AddEditCommand | ActionEditCommand

/**
 * Injectable I/O interface — production wraps readline,
 * tests pass a mock with scripted answers.
 */
export interface ApprovalIO {
  write(text: string): void
  prompt(question: string): Promise<string>
}

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

/**
 * Maps a raw user input string to an ApprovalAction.
 * Returns null if input is unrecognised — caller must re-prompt.
 */
export function parseApprovalInput(raw: string): ApprovalAction | null {
  switch (raw.trim().toLowerCase()) {
    case 'a': case 'approve': return 'approve'
    case 'e': case 'edit':    return 'edit'
    case 's': case 'skip':    return 'skip'
    case 'q': case 'quit':    return 'quit'
    default:                  return null
  }
}

/**
 * Maps a raw edit-mode command line to an EditCommand.
 * Supports:
 *   fs read <path>  |  fs write <path>  |  net <host>
 *   env <VAR>       |  spawn            |  done | reset | cancel
 */
export function parseEditCommand(raw: string): EditCommand {
  const trimmed = raw.trim()
  const lower   = trimmed.toLowerCase()

  if (lower === 'done')   return { type: 'action', action: 'done' }
  if (lower === 'reset')  return { type: 'action', action: 'reset' }
  if (lower === 'cancel') return { type: 'action', action: 'cancel' }
  if (lower === 'spawn')  return { type: 'add', category: 'spawn', value: null }

  const parts = trimmed.split(/\s+/)

  if (parts[0]?.toLowerCase() === 'fs' && parts[1]?.toLowerCase() === 'read' && parts[2]) {
    return { type: 'add', category: 'fs.read', value: parts[2] }
  }
  if (parts[0]?.toLowerCase() === 'fs' && parts[1]?.toLowerCase() === 'write' && parts[2]) {
    return { type: 'add', category: 'fs.write', value: parts[2] }
  }
  if (parts[0]?.toLowerCase() === 'net' && parts[1]) {
    return { type: 'add', category: 'net', value: parts[1] }
  }
  if (parts[0]?.toLowerCase() === 'env' && parts[1]) {
    return { type: 'add', category: 'env', value: parts[1] }
  }

  return { type: 'action', action: 'unknown' }
}

/**
 * Returns a new PackageCapability with one edit applied.
 * Never mutates the original — always returns a new object.
 */
export function applyEdit(profile: PackageCapability, cmd: AddEditCommand): PackageCapability {
  const p = deepCopy(profile)

  switch (cmd.category) {
    case 'fs.read':
      if (cmd.value && !p.fs.read.includes(cmd.value)) p.fs.read.push(cmd.value)
      break
    case 'fs.write':
      if (cmd.value && !p.fs.write.includes(cmd.value)) p.fs.write.push(cmd.value)
      break
    case 'net':
      p.net.outbound = true
      if (cmd.value && !p.net.hosts.includes(cmd.value)) p.net.hosts.push(cmd.value)
      break
    case 'env':
      if (cmd.value && !p.env.includes(cmd.value)) p.env.push(cmd.value)
      break
    case 'spawn':
      p.child_process.allowed = true
      break
  }

  return p
}

/**
 * Returns a fresh all-deny profile for the given package name and version.
 * Used when the user types "reset" in edit mode.
 */
export function resetProfile(packageName: string, version: string): PackageCapability {
  return buildProfile(packageName, version, [])
}

// ─── Approval session ──────────────────────────────────────────────────────────

/**
 * Runs the interactive approval session for all packages in `caps`.
 * Modifies a copy of the capabilities file and returns it.
 *
 * @param caps  The capabilities file produced by the profiler
 * @param io    Injectable I/O — use createReadlineIO() in production
 */
export async function runApprovalSession(
  caps: CapabilitiesFile,
  io: ApprovalIO
): Promise<CapabilitiesFile> {
  const result: CapabilitiesFile = {
    ...caps,
    packages: { ...caps.packages },
  }

  const entries = Object.entries(caps.packages)
  const total   = entries.length

  for (let idx = 0; idx < entries.length; idx++) {
    const [pkgName, profile] = entries[idx]

    // ── Display header ─────────────────────────────────────────────
    io.write('\n' + '═'.repeat(54))
    io.write(`[${idx + 1} / ${total}]  ${pkgName}  v${profile.version}`)
    io.write('═'.repeat(54))
    io.write(formatProfile(pkgName, profile))
    io.write('')
    io.write('  [A]pprove  [E]dit permissions  [S]kip  [Q]uit')

    // ── Main prompt loop (re-prompt on invalid input) ──────────────
    let action: ApprovalAction | null = null
    while (action === null) {
      const raw = await io.prompt('> ')
      action = parseApprovalInput(raw)
      if (action === null) io.write('  Unknown command. Type A, E, S or Q.')
    }

    if (action === 'quit') break

    if (action === 'skip') continue   // leave approvedBy as 'auto'

    if (action === 'approve') {
      result.packages[pkgName] = { ...profile, approvedBy: 'user' }
      continue
    }

    // ── Edit sub-flow ──────────────────────────────────────────────
    if (action === 'edit') {
      let working = deepCopy(profile)
      let editDone = false
      let cancelled = false

      io.write('')
      io.write('  Edit mode — commands:')
      io.write('    fs read <path>   fs write <path>   net <host>')
      io.write('    env <VAR>        spawn')
      io.write('    show   reset   done   cancel')

      while (!editDone && !cancelled) {
        const raw = await io.prompt('  edit> ')
        const cmd = parseEditCommand(raw)

        if (cmd.type === 'action') {
          switch (cmd.action) {
            case 'done':
              editDone = true
              break
            case 'cancel':
              cancelled = true
              break
            case 'reset':
              working = resetProfile(pkgName, profile.version)
              io.write('  Reset to all-deny.')
              break
            case 'unknown':
              if (raw.trim().toLowerCase() === 'show') {
                io.write(formatProfile(pkgName, working))
              } else {
                io.write('  Unknown edit command.')
              }
              break
          }
        } else {
          // AddEditCommand
          working = applyEdit(working, cmd)
          io.write(`  Added: ${cmd.category} ${cmd.value ?? ''}`.trim())
        }
      }

      if (editDone) {
        result.packages[pkgName] = { ...working, approvedBy: 'user' }
      }
      // if cancelled: loop back to main prompt for this package
      if (cancelled) {
        // Re-show the prompt for the same package by decrementing idx
        idx--
      }
    }
  }

  return result
}

// ─── Production readline I/O ──────────────────────────────────────────────────

/**
 * Creates a production ApprovalIO backed by Node's readline module.
 * The returned object has a `close()` method — call it when done.
 */
export function createReadlineIO(): ApprovalIO & { close(): void } {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  })

  return {
    write(text: string) {
      process.stdout.write(text + '\n')
    },
    prompt(question: string): Promise<string> {
      return new Promise(resolve => rl.question(question, resolve))
    },
    close() {
      rl.close()
    },
  }
}

// ─── Internal ──────────────────────────────────────────────────────────────────

function deepCopy(profile: PackageCapability): PackageCapability {
  return {
    ...profile,
    fs:            { read: [...profile.fs.read], write: [...profile.fs.write] },
    net:           { outbound: profile.net.outbound, hosts: [...profile.net.hosts] },
    env:           [...profile.env],
    child_process: { ...profile.child_process, allowedCommands: profile.child_process.allowedCommands ? [...profile.child_process.allowedCommands] : undefined },
  }
}
