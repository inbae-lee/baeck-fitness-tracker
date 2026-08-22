/**
 * LapLog backend — Vercel serverless function.
 * Sheet = database. Verifies a Google ID token locally against Google's
 * public keys (google-auth-library), checks the verified email against
 * ALLOWED_EMAILS, then reads/writes the WeeklyLogs sheet via a service
 * account (Sheets API).
 *
 * WeeklyLogs only holds the fields that are fixed for every user (steps,
 * rest, week metadata). Per-user, user-definable workout types live in the
 * CategoryDefs/CategoryEntries sheets (see lib/categories.js) — this
 * endpoint merges a user's category entries into each week object as
 * `c{categoryId}_{day}` fields so the frontend's week shape looks the same
 * as it did when categories were a fixed set of columns.
 */

const { verifyIdToken } = require('../lib/auth');
const {
  sheetsAccessToken, columnLetter, sheetsGetValues, sheetsUpdateValues,
  sheetsAppendValues,
} = require('../lib/sheets');
const { DAY_SUFFIXES, ensureTabs, getUserEntries, saveUserEntries } = require('../lib/categories');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'WeeklyLogs';

// New columns are always appended at the end, never inserted or reordered —
// COLUMNS positions map directly to sheet columns, so existing rows written
// under an older layout would misalign if anything earlier moved.
const COLUMNS = [
  'weekKey', 'email', 'startDate',
  'steps_mon', 'steps_tue', 'steps_wed', 'steps_thu', 'steps_fri', 'steps_sat', 'steps_sun',
  'rest_mon', 'rest_tue', 'rest_wed', 'rest_thu', 'rest_fri', 'rest_sat', 'rest_sun',
  'updatedAt',
];
const WEEK_KEY_COL = COLUMNS.indexOf('weekKey');
const EMAIL_COL = COLUMNS.indexOf('email');
const LAST_COL_LETTER = columnLetter(COLUMNS.length - 1);
const FULL_RANGE = `${SHEET_NAME}!A:${LAST_COL_LETTER}`;

// Matches the dynamic per-category fields the frontend sends, e.g.
// 'c6_mon' -> categoryId 6, day 'mon'.
const CATEGORY_FIELD_RE = /^c(\d+)_(mon|tue|wed|thu|fri|sat|sun)$/;

function rowToObject(row) {
  const obj = {};
  COLUMNS.forEach((key, i) => { obj[key] = row[i]; });
  return obj;
}

/**
 * Writes the header row if the sheet is completely empty (e.g. right after
 * clearing it out) — otherwise the first real data row would silently get
 * treated as the header by the rows.slice(1) below. Only acts on a fully
 * empty sheet; a sheet with an existing header is left alone rather than
 * risking misaligning any rows already under it.
 */
async function ensureHeaderRow(token, rows) {
  if (rows.length > 0) return rows;
  await sheetsUpdateValues(token, SHEET_ID, `${SHEET_NAME}!A1`, [COLUMNS]);
  return [COLUMNS];
}

async function handleGet(req, res) {
  const auth = await verifyIdToken(req.query.id_token);
  if (!auth.email) return res.status(200).json(Object.assign({ ok: false }, auth));

  const token = await sheetsAccessToken();
  await ensureTabs(token);

  const [rows, entriesByWeek] = await Promise.all([
    sheetsGetValues(token, SHEET_ID, FULL_RANGE),
    getUserEntries(token, auth.email),
  ]);

  const weeks = rows.slice(1) // skip header
    .filter(r => r[WEEK_KEY_COL] && r[EMAIL_COL] === auth.email) // only this user's rows
    .map(rowToObject)
    .map(week => {
      const entries = entriesByWeek[week.weekKey];
      if (entries) {
        Object.keys(entries).forEach(catId => {
          DAY_SUFFIXES.forEach(sfx => { week[`c${catId}_${sfx}`] = entries[catId][sfx]; });
        });
      }
      return week;
    });

  // A week can exist purely as category entries (no WeeklyLogs row yet is
  // unusual, but cheap to guard against) — not handled here since the
  // frontend always creates the WeeklyLogs row first via POST.
  return res.status(200).json({ ok: true, weeks });
}

async function handlePost(req, res) {
  const body = req.body || {};
  const auth = await verifyIdToken(body.id_token);
  if (!auth.email) return res.status(200).json(Object.assign({ ok: false }, auth));

  const week = body.week;
  if (!week || !week.weekKey) return res.status(200).json({ ok: false, error: 'missing_weekKey' });

  week.email = auth.email; // server-verified owner, not whatever the client sent
  week.updatedAt = new Date().toISOString();

  // Split the flat week object the frontend sends into the fixed
  // WeeklyLogs fields and the dynamic per-category entries.
  const entriesByCatId = {};
  Object.keys(week).forEach(key => {
    const m = key.match(CATEGORY_FIELD_RE);
    if (!m) return;
    const [, catId, day] = m;
    if (!entriesByCatId[catId]) entriesByCatId[catId] = {};
    entriesByCatId[catId][day] = week[key];
  });
  const rowValues = COLUMNS.map(key => (week[key] !== undefined ? week[key] : ''));

  const token = await sheetsAccessToken();
  await ensureTabs(token);

  const rows = await ensureHeaderRow(token, await sheetsGetValues(token, SHEET_ID, FULL_RANGE));

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][WEEK_KEY_COL] === week.weekKey && rows[i][EMAIL_COL] === auth.email) {
      rowIndex = i + 1; // 1-indexed sheet row
      break;
    }
  }

  if (rowIndex === -1) {
    await sheetsAppendValues(token, SHEET_ID, `${SHEET_NAME}!A1`, [rowValues]);
  } else {
    const range = `${SHEET_NAME}!A${rowIndex}:${LAST_COL_LETTER}${rowIndex}`;
    await sheetsUpdateValues(token, SHEET_ID, range, [rowValues]);
  }

  await saveUserEntries(token, auth.email, week.weekKey, entriesByCatId, week.updatedAt);

  return res.status(200).json({ ok: true, week });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    // Sheets/network hiccups land here — deliberately not one of the
    // frontend's AUTH_ERRORS codes, so a save/fetch failure doesn't sign
    // the user out for a problem that has nothing to do with their token.
    console.error('api/weeks error:', err);
    res.status(200).json({ ok: false, error: 'server_error', message: String((err && err.message) || err) });
  }
};
