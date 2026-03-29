/**
 * approval-prompt.ts
 *
 * Renders a human-readable capability summary for terminal display.
 * Used during `safenpm install` to show users what each package is requesting
 * before they approve or deny the capability profile.
 */

import type { PackageCapability } from '../capabilities/schema'

/**
 * Formats a package's capability profile as a multi-line terminal string.
 * Plain text, no ANSI codes — callers can colorize as needed.
 *
 * @param packageName  Name of the npm package
 * @param profile      The capability profile to display
 */
export function formatProfile(packageName: string, profile: PackageCapability): string {
  const lines: string[] = []

  lines.push(`Package: ${packageName} @ ${profile.version}`)
  lines.push('')

  // Filesystem
  const hasFs = profile.fs.read.length > 0 || profile.fs.write.length > 0
  if (!hasFs) {
    lines.push('  Filesystem: No filesystem access')
  } else {
    lines.push('  Filesystem:')
    if (profile.fs.read.length > 0) {
      lines.push('    Read:')
      for (const p of profile.fs.read) lines.push(`      ${p}`)
    }
    if (profile.fs.write.length > 0) {
      lines.push('    Write:')
      for (const p of profile.fs.write) lines.push(`      ${p}`)
    }
  }

  // Network
  if (!profile.net.outbound) {
    lines.push('  Network: No network access')
  } else {
    const hosts = profile.net.hosts.length > 0
      ? profile.net.hosts.join(', ')
      : '(any host)'
    lines.push(`  Network: outbound allowed → ${hosts}`)
  }

  // Environment variables
  if (profile.env.length === 0) {
    lines.push('  Env vars: No env access')
  } else {
    lines.push(`  Env vars: ${profile.env.join(', ')}`)
  }

  // Process spawning
  if (!profile.child_process.allowed) {
    lines.push('  Processes: No process spawning')
  } else {
    const cmds = profile.child_process.allowedCommands?.length
      ? profile.child_process.allowedCommands.join(', ')
      : '(any command)'
    lines.push(`  Processes: spawn allowed → ${cmds}`)
  }

  // Native modules warning
  if (profile.hasNativeModules) {
    lines.push('')
    lines.push('  ⚠  Contains native modules (.node binary addons)')
    lines.push('     Native code bypasses JavaScript security boundaries.')
  }

  return lines.join('\n')
}
