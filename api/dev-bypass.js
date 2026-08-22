/**
 * Tells the frontend whether the local-dev auth bypass is active, so it can
 * skip the Google Sign-In UI entirely on `vercel dev`. See lib/auth.js for
 * why this can never activate on a real Production deployment. Never
 * returns anything sensitive — just a boolean and the (non-secret, only
 * ever a local test account) bypass email.
 */

const IS_PRODUCTION = process.env.VERCEL_ENV === 'production';

module.exports = async function handler(req, res) {
  const enabled = !IS_PRODUCTION && !!process.env.DEV_BYPASS_EMAIL;
  res.status(200).json({ enabled, email: enabled ? process.env.DEV_BYPASS_EMAIL : null });
};
