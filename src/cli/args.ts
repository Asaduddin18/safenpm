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
  /** The raw unrecognized token (only set when command === 'unknown') */
  raw?: string
}

/**
 * Parses an argv-style array (omitting node and script path).
 *
 * @example
 *   parseArgs(['install', 'express'])  // → { command: 'install', packages: ['express'] }
 *   parseArgs(['--help'])              // → { command: 'help', packages: [] }
 */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { command: 'help', packages: [] }
  }

  const [first, ...rest] = argv

  switch (first) {
    case '--help':
    case '-h':
      return { command: 'help', packages: [] }

    case '--version':
    case '-v':
      return { command: 'version', packages: [] }

    case 'install':
      return { command: 'install', packages: rest.filter(a => !a.startsWith('-')) }

    case 'status':
      return { command: 'status', packages: [] }

    default:
      return { command: 'unknown', packages: [], raw: first }
  }
}
