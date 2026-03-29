/**
 * secret-detector.ts
 *
 * Identifies environment variable names that are likely to contain
 * credentials or secrets. Used by the env proxy to decide:
 *  - Whether to block access entirely (known high-value secrets → CRITICAL)
 *  - Whether to log a warning (pattern match → HIGH)
 *  - Whether to allow silently (safe variable → not secret)
 */

import type { ViolationSeverity } from '../capabilities/schema'

/**
 * Known high-value credential environment variables.
 * These are the variables attackers specifically target.
 * Access by any package not explicitly declaring them is CRITICAL severity.
 */
const KNOWN_SECRET_VARS = new Set<string>([
  // AWS
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  // Databases
  'DATABASE_URL',
  'DB_PASSWORD',
  'DB_HOST',
  'POSTGRES_PASSWORD',
  'MYSQL_ROOT_PASSWORD',
  'MONGO_URI',
  'REDIS_URL',
  // Payment
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  // Source control / CI
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  // Cloud platforms
  'HEROKU_API_KEY',
  'VERCEL_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  // AI APIs
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  // Generic crypto / signing
  'PRIVATE_KEY',
  'SECRET_KEY',
  'JWT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'SIGNING_KEY',
])

/**
 * Pattern-based detection for secrets not in the known list.
 * Applied case-insensitively.
 */
const SECRET_PATTERNS: RegExp[] = [
  /secret/i,
  /password/i,
  /private_key/i,
  /api_key/i,
  /access_token/i,
  /auth_token/i,
  /credentials/i,
]

/**
 * Returns true if the environment variable name is likely to contain
 * a credential or secret value.
 */
export function isSecretEnvVar(varName: string): boolean {
  if (KNOWN_SECRET_VARS.has(varName)) return true
  return SECRET_PATTERNS.some(pattern => pattern.test(varName))
}

/**
 * Returns the severity for attempting to access the given secret variable.
 * CRITICAL for known high-value vars, HIGH for pattern-matched ones.
 */
export function getSecretSeverity(varName: string): Extract<ViolationSeverity, 'HIGH' | 'CRITICAL'> {
  return KNOWN_SECRET_VARS.has(varName) ? 'CRITICAL' : 'HIGH'
}
