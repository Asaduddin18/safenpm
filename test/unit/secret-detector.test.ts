/**
 * secret-detector.test.ts
 *
 * Tests for src/utils/secret-detector.ts
 * Verifies that known high-value credential environment variable names
 * are detected accurately, and pattern matching catches unknown but
 * clearly secret-looking names.
 */

import { describe, it, expect } from 'vitest'
import { isSecretEnvVar, getSecretSeverity } from '../../src/utils/secret-detector'

describe('isSecretEnvVar — known credential variables', () => {
  const knownSecrets = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'DATABASE_URL',
    'DB_PASSWORD',
    'POSTGRES_PASSWORD',
    'MYSQL_ROOT_PASSWORD',
    'MONGO_URI',
    'REDIS_URL',
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'NPM_TOKEN',
    'HEROKU_API_KEY',
    'VERCEL_TOKEN',
    'NETLIFY_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'PRIVATE_KEY',
    'SECRET_KEY',
    'JWT_SECRET',
    'SESSION_SECRET',
    'ENCRYPTION_KEY',
    'SIGNING_KEY',
  ]

  for (const varName of knownSecrets) {
    it(`detects "${varName}" as secret`, () => {
      expect(isSecretEnvVar(varName)).toBe(true)
    })
  }
})

describe('isSecretEnvVar — pattern matching for unknown secret names', () => {
  it('detects variable containing SECRET', () => {
    expect(isSecretEnvVar('MY_APP_SECRET')).toBe(true)
    expect(isSecretEnvVar('CLIENT_SECRET')).toBe(true)
  })

  it('detects variable containing PASSWORD', () => {
    expect(isSecretEnvVar('ADMIN_PASSWORD')).toBe(true)
    expect(isSecretEnvVar('DB_PASSWORD_PROD')).toBe(true)
  })

  it('detects variable containing PRIVATE_KEY', () => {
    expect(isSecretEnvVar('RSA_PRIVATE_KEY')).toBe(true)
  })

  it('detects variable containing API_KEY', () => {
    expect(isSecretEnvVar('MAPS_API_KEY')).toBe(true)
    expect(isSecretEnvVar('SENDGRID_API_KEY')).toBe(true)
  })

  it('detects variable containing ACCESS_TOKEN', () => {
    expect(isSecretEnvVar('OAUTH_ACCESS_TOKEN')).toBe(true)
  })

  it('detects variable containing AUTH_TOKEN', () => {
    expect(isSecretEnvVar('BEARER_AUTH_TOKEN')).toBe(true)
  })

  it('is case-insensitive for pattern matching', () => {
    expect(isSecretEnvVar('my_app_secret')).toBe(true)
    expect(isSecretEnvVar('db_password')).toBe(true)
  })
})

describe('isSecretEnvVar — safe variables (should NOT be flagged)', () => {
  const safeVars = [
    'NODE_ENV',
    'PORT',
    'HOST',
    'DEBUG',
    'LOG_LEVEL',
    'HOME',
    'PATH',
    'USER',
    'SHELL',
    'TERM',
    'LANG',
    'TZ',
    'HOSTNAME',
    'APP_NAME',
    'MAX_CONNECTIONS',
  ]

  for (const varName of safeVars) {
    it(`does NOT flag safe variable "${varName}"`, () => {
      expect(isSecretEnvVar(varName)).toBe(false)
    })
  }
})

describe('getSecretSeverity', () => {
  it('returns CRITICAL for known high-value variables', () => {
    expect(getSecretSeverity('AWS_SECRET_ACCESS_KEY')).toBe('CRITICAL')
    expect(getSecretSeverity('DATABASE_URL')).toBe('CRITICAL')
    expect(getSecretSeverity('STRIPE_SECRET_KEY')).toBe('CRITICAL')
  })

  it('returns HIGH for pattern-matched but not known-list variables', () => {
    // MY_APP_SECRET matches the pattern but is not in the known list
    expect(getSecretSeverity('MY_APP_SECRET')).toBe('HIGH')
    expect(getSecretSeverity('CUSTOM_API_KEY')).toBe('HIGH')
  })
})
