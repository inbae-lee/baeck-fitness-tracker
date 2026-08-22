/**
 * Shared Google ID token verification — used by every api/ endpoint.
 * Verifies locally against Google's public keys (google-auth-library),
 * then checks the verified email against ALLOWED_EMAILS.
 */

const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);

const oauthClient = new OAuth2Client(CLIENT_ID);

/**
 * Returns { email } on success, or { error, ...detail } describing exactly
 * why it was rejected — useful for debugging a misconfigured client
 * ID/allowlist, and not sensitive to expose (worst case it confirms a
 * client ID mismatch).
 */
async function verifyIdToken(idToken) {
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
