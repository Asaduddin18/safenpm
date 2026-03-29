# safenpm — Build Log

Every completed task is logged here with: what was built, why it was built in that order, and what it enables.

---

## 2026-03-28

### P1.1 — Project Bootstrap ✅
**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.eslintrc.json`
**Why first:** Nothing can be compiled or tested without these. TypeScript strict mode enabled to catch type errors early. Vitest chosen over Jest for native TypeScript support (no babel). No runtime dependencies — all logic uses Node built-ins.
**Enables:** Compilation, testing, linting.

### P1.2 — Task and Log Files ✅
**Files:** `TASKS.md`, `BUILD_LOG.md`
**Why:** Structured checklist prevents drift. Every minute task is tracked. Log file records decisions so the build history is auditable.
**Enables:** Progress tracking across sessions.

---

## 2026-03-29

### P2 — Enforcer Shims: All Unit + Integration Tests ✅ (resumed session)
**Bug fix: Integration test failures (exit code 1 instead of 2)**
- Root cause A: `NODE_OPTIONS --require "path with spaces"` fails silently on Windows — Node strips quotes and splits on spaces, producing a garbled module path. Fix: write a `safenpm-bootstrap.js` file to `tmpDir` that embeds absolute paths as JSON strings, then set `NODE_OPTIONS='--require ./safenpm-bootstrap.js'` (no spaces).
- Root cause B: `ts-node/register` not findable in child process PATH. Fix: resolve ts-node from project `node_modules` and embed absolute path in bootstrap.
- Root cause C: TS2322 type error in `module-interceptor.ts` (function params typed as `string` not assignable to `unknown`). Fix: use `any[]` for `originalLoad` type. Though transpileOnly was set, fixing keeps codebase clean.
- Root cause D: Unused `Violation` import in `env.proxy.ts`. Fix: removed from import.
**Result:** 222/222 tests passing.

### P3.1–P3.2 — native-detector ✅
**Files:** `src/profiler/native-detector.ts`, `test/unit/profiler/native-detector.test.ts`
**What:** Recursively scans a package directory for `.node` binary addon files. Returns true if any found, false otherwise (including non-existent dirs).
**Why:** Packages with native addons bypass JS-level shims entirely. Flagging them in the profile gives users a clear warning during approval.
**Tests:** 6 unit tests — top-level .node, nested .node, missing dir, .node-suffix false positive, deeply nested.

### P3.3–P3.4 — package-resolver ✅
**Files:** `src/profiler/package-resolver.ts`, `test/unit/profiler/package-resolver.test.ts`
**What:** Reads `node_modules/` and returns `{name, version, pkgDir}[]` for every installed package. Handles scoped packages (`@scope/name`), skips `.bin`/`.cache`, skips broken installs (no package.json).
**Why:** The profiler needs to know what packages exist before building profiles. The resolver is a pure I/O function that maps the filesystem state.
**Tests:** 8 unit tests.

### P3.5–P3.6 — registry-client ✅
**Files:** `src/profiler/registry-client.ts`, `test/unit/profiler/registry-client.test.ts`
**What:** `fetchDownloadCount(pkgName, fetchFn)` — fetches weekly download count from npm registry API. Injectable fetch for testability. Gracefully returns 0 on any error (network, 404, malformed response).
**Why:** Download count is a proxy for community vetting. High-traffic packages (lodash, express) are lower risk than obscure new ones.
**Tests:** 6 unit tests using mock fetch — success, network error, 404, missing field, scoped name encoding, non-number value.

### P3.7–P3.8 — profile-builder ✅
**Files:** `src/profiler/profile-builder.ts`, `test/unit/profiler/profile-builder.test.ts`
**What:** `buildProfile(name, version, violations[])` — converts observed Violation records into a minimum-access PackageCapability. CREDENTIAL_THEFT_ATTEMPT violations are intentionally excluded from the env array (secrets never auto-approved). Deduplicates paths and hosts.
**Why:** The profiler pipeline needs to translate raw observations (what the package tried to do) into a structured profile (what it should be allowed to do).
**Tests:** 11 unit tests — empty observations, fs read/write extraction, net host extraction, env var extraction (with secret exclusion), spawn detection, deduplication, metadata fields.

### P3.9–P3.10 — profiler orchestrator ✅
**Files:** `src/profiler/index.ts`, `test/integration/profiler-scans-node-modules.test.ts`
**What:** `profileProject(projectRoot)` — wires together resolver + native-detector + profile-builder to scan a project's node_modules and return a complete CapabilitiesFile.
**Why:** The CLI needs a single function to call that produces the full capability file. The integration test verifies the pipeline works end-to-end with real filesystem operations.
**Tests:** 6 integration tests — package count, version accuracy, native detection, pure-JS packages, empty node_modules, all-deny defaults.

### P4.1–P4.2 — approval-prompt display ✅
**Files:** `src/ui/approval-prompt.ts`, `test/unit/cli/approval-prompt.test.ts`
**What:** `formatProfile(name, profile)` — renders a human-readable multi-line capability summary for terminal display. Shows package name/version, fs paths, net hosts, env vars, process spawning, and native module warning.
**Why:** Users need to see exactly what each package is requesting before approving. Plain text output (no ANSI) is used for testability; callers colorize as needed.
**Tests:** 13 unit tests covering all fields, empty states, and native module warning.

### P4.3–P4.4 — capabilities diff ✅
**Files:** `src/ui/diff-display.ts`, `test/unit/cli/diff-display.test.ts`
**What:** `diffProfiles(old, new)` — computes structured diff between two PackageCapability objects. Returns added/removed arrays for fs, net, env, and boolean flags for outbound/spawn/native changes. `hasChanges` is true if anything differed.
**Why:** On package update, users must see what new access is being requested. Without a diff, they'd have to compare profiles manually.
**Tests:** 12 unit tests covering all diff categories and the identical-profiles edge case.

### P4.5–P4.6 — CLI arg parsing ✅
**Files:** `src/cli/args.ts`, `test/unit/cli/args.test.ts`
**What:** `parseArgs(argv[])` — pure function mapping CLI args to `{command, packages, raw}`. Handles install/status/help/version/unknown commands, scoped package names.
**Why:** Pure function makes arg parsing fully unit-testable without spawning processes or touching the filesystem.
**Tests:** 9 unit tests.

### P4.7 — CLI entry point + install command ✅
**Files:** `src/cli/install.ts`, `src/cli/index.ts`
**What:** `runInstall(packages, options)` orchestrates npm install → profile → display → write. `src/cli/index.ts` is the binary entry point that routes to commands.
**Why:** These connect the profiler pipeline and UI to an actual runnable CLI tool.

### P5.1 — Dynamic require hardening ✅
**Files:** `test/fixtures/malicious-fs/index.js` (added `dynamicRequireFs`), `test/integration/enforcer-blocks-dynamic-require.test.ts`
**What:** Integration test verifies that `require('f'+'s')` (a dynamic string concatenation) is still intercepted by the enforcer.
**Why:** Module._load intercepts ALL require() calls regardless of how the module name string was constructed. This was already working — the test documents and protects that invariant.
**Tests:** 1 integration test — passes.

### P5.3 — Scoped package hardening ✅
**Files:** `test/integration/enforcer-blocks-scoped-package.test.ts`
**What:** Integration test verifies that `@scope/package-name` is correctly identified by the caller-resolver and its capability profile is applied.
**Why:** The regex in caller-resolver.ts handles `@scope/name` via `(?:@[^/]+\/[^/]+)` — this test confirms it works end-to-end.
**Tests:** 1 integration test — passes.

### P5.4 — Capabilities diff integration test ✅
**Files:** `test/integration/capabilities-diff.test.ts`
**What:** Integration tests covering realistic upgrade scenarios — net access added, fs access dropped, spawn added, native module added, identical profiles.
**Why:** Validates that the diff logic handles realistic version-upgrade scenarios correctly.
**Tests:** 5 integration tests — passes.

### P5.5 — Final full suite ✅
**Result:** 300/300 tests passing. `npx tsc --noEmit` = zero errors.
**Test files:** 28 test files across unit and integration suites.
**Coverage:** Enforcer shims (fs, env, net, http, https, dns, child_process), profiler pipeline, CLI, hardening (dynamic require, scoped packages, node: prefix, capabilities diff).
