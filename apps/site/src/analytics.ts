/**
 * Origin of the self-hosted Plausible (VB-74) from the wrangler var `PLAUSIBLE_HOST` (a bare
 * hostname). Unset or empty means no script and no CSP entry; anything that is not a hostname
 * throws, because the value ends up in the CSP header.
 */
export function plausibleOrigin(host: string | undefined): string | undefined {
  if (!host) return undefined;
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host)) {
    throw new Error(`PLAUSIBLE_HOST must be a bare hostname, got "${host}"`);
  }
  return `https://${host}`;
}
