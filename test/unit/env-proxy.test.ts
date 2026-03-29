/**
 * env-proxy.test.ts
 *
 * Tests for src/enforcer/shims/env.proxy.ts
 *
 * The env proxy intercepts process.env property reads.
 * Uses injectable getCallerFn to simulate reads coming from a package
 * (vs. from user's own application code).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEnvProxy } from '../../src/enforcer/shims/env.proxy'
import type { CapabilitiesFile, Violation } from '../../src/capabilities/schema'

const baseCapabilities: CapabilitiesFile = {
  version: '1.0',
  generatedAt: '2026-01-01T00:00:00Z',
  projectRoot: '/project',
  packages: {
    'my-mailer': {
      version: '1.0.0',
      fs: { read: [], write: [] },
      net: { outbound: true, hosts: ['smtp.gmail.com'] },
      env: ['SMTP_HOST', 'SMTP_PORT'],
      child_process: { allowed: false },
      worker_threads: false,
      hasNativeModules: false,
      approvedBy: 'user',
      approvedAt: '2026-01-01T00:00:00Z',
    },
    'evil-package': {
      version: '1.0.0',
      fs: { read: [], write: [] },
      net: { outbound: false, hosts: [] },
      env: [],
      child_process: { allowed: false },
      worker_threads: false,
      hasNativeModules: false,
      approvedBy: 'user',
      approvedAt: '2026-01-01T00:00:00Z',
    },
  },
}

const fakeEnv: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  PORT: '3000',
  AWS_SECRET_ACCESS_KEY: 'AKIASECRETKEY123',
  DATABASE_URL: 'postgres://user:pass@localhost/db',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
}

describe('env proxy — package reads KNOWN secrets', () => {
  let violations: Violation[]
  let proxy: typeof fakeEnv

  beforeEach(() => {
    violations = []
    proxy = createEnvProxy(
      fakeEnv,
      baseCapabilities,
      () => 'evil-package', // simulate call from evil-package
      v => violations.push(v)
    )
  })

  it('returns undefined for AWS_SECRET_ACCESS_KEY — does not leak the value', () => {
    expect(proxy['AWS_SECRET_ACCESS_KEY']).toBeUndefined()
  })

  it('logs a CRITICAL violation for AWS_SECRET_ACCESS_KEY', () => {
    void proxy['AWS_SECRET_ACCESS_KEY']
    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('CRITICAL')
    expect(violations[0].reason).toBe('CREDENTIAL_THEFT_ATTEMPT')
    expect(violations[0].blocked).toBe(true)
    expect(violations[0].package).toBe('evil-package')
    expect(violations[0].attempted).toContain('AWS_SECRET_ACCESS_KEY')
  })

  it('returns undefined for DATABASE_URL — credential theft blocked', () => {
    expect(proxy['DATABASE_URL']).toBeUndefined()
    expect(violations[0].severity).toBe('CRITICAL')
  })

  it('returns undefined for MY_APP_SECRET (pattern-matched)', () => {
    const env2 = { ...fakeEnv, MY_APP_SECRET: 'hunter2' }
    const proxy2 = createEnvProxy(env2, baseCapabilities, () => 'evil-package', v => violations.push(v))
    expect(proxy2['MY_APP_SECRET']).toBeUndefined()
    expect(violations[0].severity).toBe('HIGH') // pattern match, not known list
  })
})

describe('env proxy — package reads UNDECLARED non-secret vars', () => {
  let violations: Violation[]
  let proxy: typeof fakeEnv

  beforeEach(() => {
    violations = []
    proxy = createEnvProxy(
      fakeEnv,
      baseCapabilities,
      () => 'evil-package',
      v => violations.push(v)
    )
  })

  it('allows read of NODE_ENV but logs LOW violation', () => {
    const result = proxy['NODE_ENV']
    expect(result).toBe('production') // value is returned
    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('LOW')
    expect(violations[0].reason).toBe('UNDECLARED_ENV_ACCESS')
    expect(violations[0].blocked).toBe(false) // allowed but logged
  })

  it('allows read of PORT but logs it', () => {
    void proxy['PORT']
    expect(violations[0].blocked).toBe(false)
  })
})

describe('env proxy — package reads DECLARED env vars', () => {
  let violations: Violation[]
  let proxy: typeof fakeEnv

  beforeEach(() => {
    violations = []
    proxy = createEnvProxy(
      fakeEnv,
      baseCapabilities,
      () => 'my-mailer', // my-mailer has SMTP_HOST, SMTP_PORT declared
      v => violations.push(v)
    )
  })

  it('allows read of declared SMTP_HOST without logging a violation', () => {
    const result = proxy['SMTP_HOST']
    expect(result).toBe('smtp.gmail.com')
    expect(violations).toHaveLength(0)
  })

  it('allows read of declared SMTP_PORT without logging a violation', () => {
    const result = proxy['SMTP_PORT']
    expect(result).toBe('587')
    expect(violations).toHaveLength(0)
  })

  it('blocks undeclared secret even for my-mailer', () => {
    void proxy['AWS_SECRET_ACCESS_KEY']
    expect(violations[0].blocked).toBe(true)
    expect(violations[0].severity).toBe('CRITICAL')
  })
})

describe('env proxy — user application code (null caller) has full access', () => {
  it('returns real value with no violations when caller is null (own code)', () => {
    const violations: Violation[] = []
    const proxy = createEnvProxy(
      fakeEnv,
      baseCapabilities,
      () => null, // null = user's own code
      v => violations.push(v)
    )

    expect(proxy['AWS_SECRET_ACCESS_KEY']).toBe('AKIASECRETKEY123')
    expect(violations).toHaveLength(0)
  })
})

describe('env proxy — mutation logging', () => {
  it('logs MEDIUM violation when a package writes to process.env', () => {
    const violations: Violation[] = []
    const proxy = createEnvProxy(
      { ...fakeEnv },
      baseCapabilities,
      () => 'evil-package',
      v => violations.push(v)
    )

    proxy['NEW_VAR'] = 'injected'
    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('MEDIUM')
    expect(violations[0].reason).toBe('ENV_MUTATION')
    expect(violations[0].blocked).toBe(false) // mutation is logged but allowed
  })

  it('user code mutation is NOT logged', () => {
    const violations: Violation[] = []
    const proxy = createEnvProxy(
      { ...fakeEnv },
      baseCapabilities,
      () => null,
      v => violations.push(v)
    )

    proxy['NEW_VAR'] = 'value'
    expect(violations).toHaveLength(0)
  })
})

describe('env proxy — package with no profile entry', () => {
  it('blocks known secrets for unknown package', () => {
    const violations: Violation[] = []
    const proxy = createEnvProxy(
      fakeEnv,
      baseCapabilities,
      () => 'unknown-package', // not in capabilities file
      v => violations.push(v)
    )

    void proxy['AWS_SECRET_ACCESS_KEY']
    expect(violations[0].blocked).toBe(true)
  })
})
