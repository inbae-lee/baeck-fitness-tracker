/**
 * Shared Google ID token verification — used by every api/ endpoint.
 * Verifies locally against Google's public keys (google-auth-library),
 * then checks the verified email against ALLOWED_EMAILS.
 */

const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);

const oauthClient = new OAuth2Client(CLIENT_ID);

// Local-dev-only bypass, so `vercel dev` doesn't need a real Google sign-in
// each session. Gated on TWO independent things, both required:
//   1. process.env.VERCEL_ENV !== 'production' — Vercel sets this on every
//      deployed function (development/preview/production), so a real
//      Production deployment can NEVER take this branch regardless of what
//      env vars happen to be set.
//   2. DEV_BYPASS_EMAIL being set at all — put this ONLY in a local
//      .env.local file (see README), never via `vercel env add`, so it can
//      never reach Vercel's server-side env config in the first place.
// The sentinel token also has to match exactly, so a stray/empty idToken
// doesn't accidentally trigger this.
const DEV_BYPASS_EMAIL = process.env.DEV_BYPASS_EMAIL;
const DEV_BYPASS_TOKEN = 'DEV_BYPASS';
const IS_PRODUCTION = process.env.VERCEL_ENV === 'production';

/**
 * Returns { email } on success, or { error, ...detail } describing exactly
 * why it was rejected — useful for debugging a misconfigured client
 * ID/allowlist, and not sensitive to expose (worst case it confirms a
 * client ID mismatch).
 */
async function verifyIdToken(idToken) {
  if (!IS_PRODUCTION && DEV_BYPASS_EMAIL && idToken === DEV_BYPASS_TOKEN) {
    if (ALLOWED_EMAILS.indexOf(DEV_BYPASS_EMAIL) === -1) {
      return { error: 'email_not_allowlisted', email: DEV_BYPASS_EMAIL };
    }
    return { email: DEV_BYPASS_EMAIL };
  }
  if (!idToken) return { error: 'missing_token' };
  let payload;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: CLIENT_ID });
    payload = ticket.getPayload();
  } catch (err) {
    if (String(err && err.message).includes('Wrong recipient')) {
      return { error: 'client_id_mismatch' };
    }
    return { error: 'invalid_token' };
  }
  if (payload.email_verified !== true) {
    return { error: 'email_not_verified', email: payload.email };
  }
  if (ALLOWED_EMAILS.indexOf(payload.email) === -1) {
    return { error: 'email_not_allowlisted', email: payload.email };
  }
  return { email: payload.email };
}

module.exports = { verifyIdToken };
