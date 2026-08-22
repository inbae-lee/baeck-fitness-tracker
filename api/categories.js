/**
 * LapLog backend — per-user workout-type (category) CRUD.
 * See lib/categories.js for the CategoryDefs schema and id-per-email
 * scheme this endpoint reads/writes through.
 */

const { verifyIdToken } = require('../lib/auth');
const { sheetsAccessToken } = require('../lib/sheets');
const { ensureTabs, getUserCategories, upsertCategory } = require('../lib/categories');

async function handleGet(req, res) {
  const auth = await verifyIdToken(req.query.id_token);
  if (!auth.email) return res.status(200).json(Object.assign({ ok: false }, auth));

  const token = await sheetsAccessToken();
  await ensureTabs(token);
  const categories = await getUserCategories(token, auth.email);
  return res.status(200).json({ ok: true, categories });
}

async function handlePost(req, res) {
  const body = req.body || {};
  const auth = await verifyIdToken(body.id_token);
  if (!auth.email) return res.status(200).json(Object.assign({ ok: false }, auth));

  const category = body.category;
  if (!category || typeof category !== 'object') {
    return res.status(200).json({ ok: false, error: 'missing_category' });
  }

  const token = await sheetsAccessToken();
  await ensureTabs(token);
  const saved = await upsertCategory(token, auth.email, category);
  return res.status(200).json({ ok: true, category: saved });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('api/categories error:', err);
    res.status(200).json({ ok: false, error: 'server_error', message: String((err && err.message) || err) });
  }
};
