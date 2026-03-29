# safenpm — Task Checklist

Every task follows TDD: tests written BEFORE implementation.
Log every completion in BUILD_LOG.md.
Rule: before moving to next step ALL tests (unit + integration) for the current step must pass.

---

## Phase 1 — Core Infrastructure ✅ COMPLETE

- [x] **P1.1** Project bootstrap: package.json, tsconfig.json, vitest.config.ts, .gitignore
- [x] **P1.2** TASKS.md + BUILD_LOG.md created
- [x] **P1.3** `src/capabilities/schema.ts` — all TypeScript interfaces
- [x] **P1.4** Write + pass tests: path-resolver, secret-detector, exfil-detector, stack-parser
- [x] **P1.5** Implement path-resolver, secret-detector, exfil-detector, stack-parser
- [x] **P1.6** Write + pass tests: path-matcher, caller-resolver
- [x] **P1.7** Implement path-matcher, caller-resolver
- [x] **P1.8** Implement violation-logger

---

## Phase 2 — The Enforcer Shims ✅ COMPLETE

- [x] **P2.1** Write + pass unit tests for all 6 shims (fs, env, net, http, https, dns, child_process)
- [x] **P2.2** Implement all 6 enforcer shims — all unit tests pass
- [x] **P2.3** Implement capabilities reader/writer + module-interceptor + enforcer entry point
- [x] **P2.4** Create 7 test fixtures (6 malicious + 1 legitimate)
- [x] **P2.5** Write + pass 15 integration tests across 6 test files
     Fix: NODE_OPTIONS path-with-spaces bug → bootstrap file approach
     Fix: env.proxy.ts unused Violation import → removed
     Fix: module-interceptor.ts (...args: any[]) type → resolved TS2322

---

## Phase 3 — The Profiler

### P3.1 — Write tests: native-detector
- [x] **P3.1a** Test: `hasNativeModules(dir)` returns false for a dir with no .node files
- [x] **P3.1b** Test: `hasNativeModules(dir)` returns true for a dir that contains a .node file
- [x] **P3.1c** Test: `hasNativeModules(dir)` returns true when .node is in a subdirectory
- [x] **P3.1d** Test: `hasNativeModules(dir)` returns false for non-existent directory
- [x] **P3.1e** Run tests — all 4 must FAIL (red, not yet implemented)

### P3.2 — Implement native-detector
- [x] **P3.2a** Implement `src/profiler/native-detector.ts` — recursive scan for .node files
- [x] **P3.2b** Run P3.1 tests — all 4 must PASS (green)

### P3.3 — Write tests: package-resolver
- [x] **P3.3a** Test: `resolveInstalledPackages(root)` returns empty array when node_modules absent
- [x] **P3.3b** Test: returns `[{name, version, pkgDir}]` for each package with a package.json
- [x] **P3.3c** Test: handles scoped packages (`@scope/name`) correctly
- [x] **P3.3d** Test: skips entries without package.json (broken installs)
- [x] **P3.3e** Run tests — all must FAIL (red)

### P3.4 — Implement package-resolver
- [x] **P3.4a** Implement `src/profiler/package-resolver.ts`
- [x] **P3.4b** Run P3.3 tests — all must PASS (green)

### P3.5 — Write tests: registry-client
- [x] **P3.5a** Test: `fetchDownloadCount(pkg)` returns number from mocked registry response
- [x] **P3.5b** Test: returns 0 on network error (graceful fallback)
- [x] **P3.5c** Test: returns 0 for scoped package names (edge case encoding)
- [x] **P3.5d** Run tests — all must FAIL (red)

### P3.6 — Implement registry-client
- [x] **P3.6a** Implement `src/profiler/registry-client.ts` — HTTPS request to registry.npmjs.org
- [x] **P3.6b** Run P3.5 tests — all must PASS (green)

### P3.7 — Write tests: profile-builder
- [x] **P3.7a** Test: `buildProfile(pkg, ver, observations)` maps fs violations → fs.read/write arrays
- [x] **P3.7b** Test: maps net violations → net.outbound true + hosts array
- [x] **P3.7c** Test: maps env violations → env array (only non-secret vars)
- [x] **P3.7d** Test: maps spawn violations → child_process.allowed true
- [x] **P3.7e** Test: `buildProfile` with empty observations → all-deny profile
- [x] **P3.7f** Test: `buildProfile` deduplies duplicate paths and hosts
- [x] **P3.7g** Run tests — all must FAIL (red)

### P3.8 — Implement profile-builder
- [x] **P3.8a** Implement `src/profiler/profile-builder.ts`
- [x] **P3.8b** Run P3.7 tests — all must PASS (green)

### P3.9 — Write integration test: profiler dry-run
- [x] **P3.9a** Test: profiler scans a node_modules dir and returns profiles for all packages
- [x] **P3.9b** Test: native module detection is included in the profile output
- [x] **P3.9c** Run tests — must FAIL (red)

### P3.10 — Implement profiler index (orchestrator)
- [x] **P3.10a** Implement `src/profiler/index.ts` — calls resolver, native-detector, profile-builder
- [x] **P3.10b** Run P3.9 tests + ALL prior tests — everything must PASS (green)

---

## Phase 4 — The CLI

### P4.1 — Write tests: approval-prompt
- [x] **P4.1a** Test: `formatProfile(pkg, profile)` returns a human-readable string summary
- [x] **P4.1b** Test: output includes package name, fs paths, net hosts, env vars
- [x] **P4.1c** Test: output flags `hasNativeModules: true` with a warning
- [x] **P4.1d** Run tests — must FAIL (red)

### P4.2 — Implement approval-prompt display
- [x] **P4.2a** Implement `src/ui/approval-prompt.ts` — `formatProfile()` function
- [x] **P4.2b** Run P4.1 tests — all must PASS (green)

### P4.3 — Write tests: capabilities diff
- [x] **P4.3a** Test: `diffProfiles(old, new)` returns `{ added, removed, changed }` correctly
- [x] **P4.3b** Test: new fs paths appear in `added.fs`
- [x] **P4.3c** Test: removed net hosts appear in `removed.net`
- [x] **P4.3d** Test: identical profiles produce empty diff
- [x] **P4.3e** Run tests — must FAIL (red)

### P4.4 — Implement capabilities diff
- [x] **P4.4a** Implement `src/ui/diff-display.ts` — `diffProfiles()` function
- [x] **P4.4b** Run P4.3 tests — all must PASS (green)

### P4.5 — Write tests: CLI arg parsing
- [x] **P4.5a** Test: `parseArgs(['install'])` returns `{ command: 'install', packages: [] }`
- [x] **P4.5b** Test: `parseArgs(['install', 'express'])` returns `{ packages: ['express'] }`
- [x] **P4.5c** Test: `parseArgs(['--help'])` returns `{ command: 'help' }`
- [x] **P4.5d** Test: unknown command returns `{ command: 'unknown', raw: '...' }`
- [x] **P4.5e** Run tests — must FAIL (red)

### P4.6 — Implement CLI arg parsing
- [x] **P4.6a** Implement `src/cli/args.ts` — `parseArgs()` function
- [x] **P4.6b** Run P4.5 tests — all must PASS (green)

### P4.7 — Implement CLI install command + entry point
- [x] **P4.7a** Implement `src/cli/install.ts` — orchestrates profiler → approval → writer
- [x] **P4.7b** Implement `src/cli/index.ts` — entry point, routes to commands
- [x] **P4.7c** Run ALL tests — everything must PASS (green)

---

## Phase 5 — Hardening

### P5.1 — Dynamic require interception
- [x] **P5.1a** Write integration test: package uses `const mod = 'fs'; require(mod)` — must be blocked
- [x] **P5.1b** Verify test passes (dynamic require already goes through Module._load)
- [x] **P5.1c** Run ALL tests — must PASS

### P5.2 — Verify node: prefix coverage
- [x] **P5.2a** Integration test already exists and passes (enforcer-blocks-node-prefix.test.ts) ✅

### P5.3 — Verify scoped package support
- [x] **P5.3a** Write integration test: `@scope/malicious-pkg` in node_modules is blocked correctly
- [x] **P5.3b** Run test — must PASS

### P5.4 — Write + run capabilities diff integration test
- [x] **P5.4a** Write test: loading old capabilities file + new profile → diff shows net added
- [x] **P5.4b** Run test — must PASS

### P5.5 — Final full suite run + BUILD_LOG update
- [x] **P5.5a** Run `npx vitest run` — 100% pass
- [x] **P5.5b** Run `npx tsc --noEmit` — zero errors
- [x] **P5.5c** Update BUILD_LOG.md with all P3/P4/P5 completions
