#!/usr/bin/env node
/**
 * cli/index.ts
 *
 * Entry point for the `safenpm` CLI binary.
 * Parses args and routes to the appropriate command handler.
 */

import { parseArgs } from './args'
import { runInstall } from './install'

const HELP_TEXT = `
safenpm — npm install with runtime capability enforcement

Usage:
  safenpm install [packages...]   Install packages and generate capability profiles
  safenpm status                  Show current capability profile summary
  safenpm --help                  Show this help message
  safenpm --version               Show version

Examples:
  safenpm install express         Install express and profile its capabilities
  safenpm install                 Re-profile all already-installed packages
  safenpm install lodash axios    Install multiple packages at once

After install, load the enforcer when running your app:
  node --require safenpm your-app.js
`.trim()

const VERSION = '0.1.0'

async function main(): Promise<void> {
  // argv[0] = node, argv[1] = script path — slice both off
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)

  switch (args.command) {
    case 'install':
      await runInstall(args.packages)
      break

    case 'status': {
      const { loadCapabilities } = await import('../capabilities/reader')
      const caps = loadCapabilities()
      if (!caps) {
        process.stderr.write('[safenpm] No package-capabilities.json found. Run `safenpm install` first.\n')
        process.exit(1)
      }
      const pkgs = Object.keys(caps.packages)
      process.stdout.write(`[safenpm] ${pkgs.length} package(s) profiled:\n`)
      for (const name of pkgs) {
        const p = caps.packages[name]
        const flags = [
          p.net.outbound ? 'net' : null,
          p.fs.read.length > 0 || p.fs.write.length > 0 ? 'fs' : null,
          p.child_process.allowed ? 'spawn' : null,
          p.hasNativeModules ? 'native' : null,
        ].filter(Boolean).join(', ')
        process.stdout.write(`  ${name}@${p.version}  [${flags || 'no access'}]\n`)
      }
      break
    }

    case 'version':
      process.stdout.write(`safenpm ${VERSION}\n`)
      break

    case 'help':
    case 'unknown':
      if (args.command === 'unknown') {
        process.stderr.write(`[safenpm] Unknown command: ${args.raw ?? ''}\n\n`)
      }
      process.stdout.write(HELP_TEXT + '\n')
      if (args.command === 'unknown') process.exit(1)
      break
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[safenpm] Fatal: ${String(err)}\n`)
  process.exit(1)
})
