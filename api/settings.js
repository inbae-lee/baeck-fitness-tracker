/**
 * LapLog backend — per-user account settings (currently just the Daily
 * Steps weekly minimum). See lib/userSettings.js for the UserSettings
 * schema.
 */

const { verifyIdToken } = require('../lib/auth');
const { sheetsAccessToken } = require('../lib/sheets');
const { ensureTab, getUserSettings, upsertUserSettings } = require('../lib/userSettings');

async function handleGet(req, res) {
  const auth = await verifyIdToken(req.query.id_token);
  if (!auth.email) return res.status(200).json(Object.assign({ ok: false }, auth));

  const token = await sheetsAccessToken();
  await ensureTab(token);
  const settings = await getUserSettings(token, auth.email);
  return res.status(200).json({ ok: true, settings });
}

async function handlePost(req, res) {
  const body = req.body || {};
  const auth = await verifyIdToken(body.id_token);
  if (!auth.email) return res.status(200).json(Object.assign({ ok: false }, auth));

  const token = await sheetsAccessToken();
  await ensureTab(token);
  const settings = await upsertUserSettings(token, auth.email, body.settings || {});
  return res.status(200).json({ ok: true, settings });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('api/settings error:', err);
    res.status(200).json({ ok: false, error: 'server_error', message: String((err && err.message) || err) });
  }
};
