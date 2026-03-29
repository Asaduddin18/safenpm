/**
 * args.ts
 *
 * Parses process.argv-style arguments for the safenpm CLI.
 * Pure function — no side effects, fully unit-testable.
 */

export type Command = 'install' | 'status' | 'help' | 'version' | 'unknown'

export interface ParsedArgs {
  command: Command
  /** Package names passed after "install" */
  packages: string[]
  /** If true, skip the interactive approval prompt and auto-approve all profiles */
  autoApprove: boolean
  /** The raw unrecognized token (only set when command === 'unknown') */
  raw?: string
}

/**
 * Parses an argv-style array (omitting node and script path).
 *
 * @example
 *   parseArgs(['install', 'express'])       // → { command: 'install', packages: ['express'], autoApprove: false }
 *   parseArgs(['install', '--yes'])         // → { command: 'install', packages: [], autoApprove: true }
 *   parseArgs(['--help'])                   // → { command: 'help', ... }
 */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { command: 'help', packages: [], autoApprove: false }
  }

  const [first, ...rest] = argv

  switch (first) {
    case '--help':
    case '-h':
      return { command: 'help', packages: [], autoApprove: false }

    case '--version':
    case '-v':
      return { command: 'version', packages: [], autoApprove: false }

    case 'install': {
      const flags    = rest.filter(a => a.startsWith('-'))
      const packages = rest.filter(a => !a.startsWith('-'))
      const autoApprove = flags.includes('--yes') || flags.includes('-y')
      return { command: 'install', packages, autoApprove }
    }

    case 'status':
      return { command: 'status', packages: [], autoApprove: false }

    default:
      return { command: 'unknown', packages: [], autoApprove: false, raw: first }
  }
}
