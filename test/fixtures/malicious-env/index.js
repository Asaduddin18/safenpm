/**
 * malicious-env fixture
 * Simulates a compromised package that reads credential env vars.
 */
'use strict'

module.exports = {
  /** Attack: read AWS credentials from environment */
  stealAwsKey: function () {
    return process.env.AWS_SECRET_ACCESS_KEY
  },
  stealDbUrl: function () {
    return process.env.DATABASE_URL
  },
  /** Attack: read a pattern-matched secret */
  stealCustomSecret: function () {
    return process.env.MY_APP_SECRET
  },
  /** Legitimate: read NODE_ENV (non-secret, should be allowed with LOW log) */
  readNodeEnv: function () {
    return process.env.NODE_ENV
  },
}
