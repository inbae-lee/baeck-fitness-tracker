/**
 * LapLog backend — Vercel serverless function.
 * Sheet = database. Verifies a Google ID token locally against Google's
 * public keys (google-auth-library), checks the verified email against
 * ALLOWED_EMAILS, then reads/writes the WeeklyLogs sheet via a service
 * account (Sheets API).
 */

const { OAuth2Client, GoogleAuth } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_PRIVATE_KEY = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);

const SHEET_NAME = 'WeeklyLogs';
const COLUMNS = [
  'weekKey', 'email', 'startDate',
  'uphillWalk', 'slowJog', 'strength',
  'steps_mon', 'steps_tue', 'steps_wed', 'steps_thu', 'steps_fri', 'steps_sat', 'steps_sun',
  'padel', 'golf', 'restDay',
  'updatedAt',
];
const WEEK_KEY_COL = COLUMNS.indexOf('weekKey');
const EMAIL_COL = COLUMNS.indexOf('email');
const LAST_COL_LETTER = String.fromCharCode('A'.charCodeAt(0) + COLUMNS.length - 1); // 'Q' for 17 columns
const FULL_RANGE = `${SHEET_NAME}!A:${LAST_COL_LETTER}`;

const oauthClient = new OAuth2Client(CLIENT_ID);

/**
 * Verifies a Google ID token. Returns { email } on success, or
 * { error, ...detail } describing exactly why it was rejected — useful for
 * debugging a misconfigured client ID/allowlist, and not sensitive to
 * expose (worst case it confirms a client ID mismatch).
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

async function sheetsAccessToken() {
  const auth = new GoogleAuth({
    credentials: {
      client_email: SERVICE_ACCOUNT_EMAIL,
      private_key: SERVICE_ACCOUNT_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function sheetsGetRows(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(FULL_RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API GET responded ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

function rowToObject(row) {
  const obj = {};
  COLUMNS.forEach((key, i) => { obj[key] = row[i]; });
  return obj;
}

async function handleGet(req, res) {
  const auth = await verifyIdToken(req.query.id_token);
  if (!auth.email) return res.status(200).json(Object.assign({ ok: false }, auth));

  const token = await sheetsAccessToken();
  const rows = await sheetsGetRows(token);
  const weeks = rows.slice(1) // skip header
    .filter(r => r[WEEK_KEY_COL] && r[EMAIL_COL] === auth.email) // only this user's rows
    .map(rowToObject);
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
  const rowValues = COLUMNS.map(key => (week[key] !== undefined ? week[key] : ''));

  const token = await sheetsAccessToken();
  const rows = await sheetsGetRows(token);

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][WEEK_KEY_COL] === week.weekKey && rows[i][EMAIL_COL] === auth.email) {
      rowIndex = i + 1; // 1-indexed sheet row
      break;
    }
  }

  if (rowIndex === -1) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_NAME + '!A1')}:append?valueInputOption=RAW`;
    const appendRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [rowValues] }),
    });
    if (!appendRes.ok) throw new Error(`Sheets API append responded ${appendRes.status}: ${await appendRes.text()}`);
  } else {
    const range = `${SHEET_NAME}!A${rowIndex}:${LAST_COL_LETTER}${rowIndex}`;
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [rowValues] }),
    });
    if (!updateRes.ok) throw new Error(`Sheets API update responded ${updateRes.status}: ${await updateRes.text()}`);
  }

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
