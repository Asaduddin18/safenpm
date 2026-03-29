/**
 * violation-logger.ts
 *
 * Default ViolationHandler implementation.
 * Writes structured JSON to .safenpm-violations.log and prints
 * color-coded output to stderr so it never interferes with app stdout.
 *
 * All shims accept an injectable ViolationHandler so tests can capture
 * violations without any file I/O. This module is only used in production.
 */

import fs from 'fs'
import path from 'path'
import type { Violation, ViolationSeverity } from '../capabilities/schema'

const LOG_FILE = path.join(process.cwd(), '.safenpm-violations.log')

// ANSI color codes
const COLORS: Record<ViolationSeverity | 'reset', string> = {
  CRITICAL: '\x1b[41m\x1b[97m', // white text on red background
  HIGH:     '\x1b[31m',          // red text
  MEDIUM:   '\x1b[33m',          // yellow text
  LOW:      '\x1b[36m',          // cyan text
  reset:    '\x1b[0m',
}

/**
 * The default violation handler used when the enforcer is active.
 * - Appends JSON line to .safenpm-violations.log (non-blocking)
 * - Prints human-readable report to stderr
 */
export function logViolation(v: Violation): void {
  const line = JSON.stringify({ ...v, timestamp: new Date().toISOString() })

  // Non-blocking append to log file
  fs.appendFile(LOG_FILE, line + '\n', () => { /* intentionally fire-and-forget */ })

  // Always write to stderr synchronously so it's visible before process may exit
  printToStderr(v)
}

function printToStderr(v: Violation): void {
  const c = COLORS[v.severity]
  const r = COLORS.reset
  const status = v.blocked ? 'BLOCKED' : 'LOGGED'

  const topFrame = v.stackTrace.find(f => f.includes('node_modules')) ?? v.stackTrace[0] ?? 'unknown'

  process.stderr.write(
    `\n${c}[safenpm ${v.severity}]${r} ${status}\n` +
    `  Package  : ${v.package}@${v.packageVersion}\n` +
    `  Attempted: ${v.attempted}\n` +
    `  Reason   : ${v.reason}\n` +
    `  Location : ${topFrame.trim()}\n`
  )
}
