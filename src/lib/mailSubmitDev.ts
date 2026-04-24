/**
 * Controls whether `/api/mail/{po,sr,pr}` proxies skip calling Applied BAS (no real email).
 *
 * Skips when:
 * - `NODE_ENV === "development"` (e.g. `next dev`), unless overridden
 * - `SKIP_MAIL_ON_SUBMIT=true` in any environment
 *
 * Never skips when `FORCE_MAIL_SEND=true` (e.g. E2E against a local `next dev` server).
 */
export function shouldSkipMailUpstream(): boolean {
  if (process.env.FORCE_MAIL_SEND === "true") {
    return false;
  }
  if (process.env.SKIP_MAIL_ON_SUBMIT === "true") {
    return true;
  }
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  return false;
}
