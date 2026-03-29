/**
 * registry-client.ts
 *
 * Fetches package metadata from the npm registry.
 * The fetch function is injectable so unit tests can mock network calls.
 *
 * Uses the npm download-counts API:
 *   https://api.npmjs.org/downloads/point/last-week/<package>
 *
 * A high weekly download count signals a widely-used, community-vetted package
 * (lower risk). A low count (new/obscure) may warrant extra scrutiny.
 */

/** Minimal fetch interface — compatible with node-fetch, undici, and browser fetch. */
export type FetchFn = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/** Default fetch using Node's built-in https module (no external deps). */
const defaultFetch: FetchFn = (url: string) =>
  new Promise((resolve, reject) => {
    const https = require('https') as typeof import('https')
    https.get(url, (res) => {
      let body = ''
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => {
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          json: async () => JSON.parse(body) as unknown,
        })
      })
    }).on('error', reject)
  })

/**
 * Returns the weekly download count for a package from the npm registry.
 * Returns 0 on any error (network failure, 404, malformed response).
 *
 * @param packageName  Package name, may be scoped (e.g. @aws-sdk/client-s3)
 * @param fetch        Injectable fetch function (defaults to Node https.get)
 */
export async function fetchDownloadCount(
  packageName: string,
  fetch: FetchFn = defaultFetch
): Promise<number> {
  try {
    // Scoped packages need full percent-encoding: @aws-sdk/client-s3 → %40aws-sdk%2Fclient-s3
    const encodedName = encodeURIComponent(packageName)
    const url = `https://api.npmjs.org/downloads/point/last-week/${encodedName}`

    const response = await fetch(url)
    if (!response.ok) return 0

    const data = await response.json() as Record<string, unknown>
    const downloads = data['downloads']

    return typeof downloads === 'number' ? downloads : 0
  } catch {
    return 0
  }
}
