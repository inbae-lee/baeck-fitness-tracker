/**
 * Shared Google Sheets REST helpers — used by the api/ serverless functions
 * and by one-off scripts/ migrations. Plain fetch calls against the Sheets
 * API v4 rather than the googleapis SDK, matching the style the project
 * started with in api/weeks.js.
 */

const { GoogleAuth } = require('google-auth-library');

const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_PRIVATE_KEY = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

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

// Base-26 spreadsheet column letters (A, B, ... Z, AA, AB, ...).
function columnLetter(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode('A'.charCodeAt(0) + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

async function sheetsGetValues(token, sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API GET ${range} responded ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

async function sheetsUpdateValues(token, sheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Sheets API PUT ${range} responded ${res.status}: ${await res.text()}`);
}

async function sheetsAppendValues(token, sheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Sheets API append ${range} responded ${res.status}: ${await res.text()}`);
}

async function sheetsClearValues(token, sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:clear`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API clear ${range} responded ${res.status}: ${await res.text()}`);
}

async function getSpreadsheetMeta(token, sheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API GET meta responded ${res.status}: ${await res.text()}`);
  return res.json();
}

// Adds a new tab (with the given header row) if a tab with this title
// doesn't already exist — safe to call on every cold start / script run.
async function ensureSheetTab(token, sheetId, title, headerRow) {
  const meta = await getSpreadsheetMeta(token, sheetId);
  const exists = (meta.sheets || []).some(s => s.properties && s.properties.title === title);
  if (exists) return;

  const addUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
  const addRes = await fetch(addUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  if (!addRes.ok) throw new Error(`Sheets API addSheet ${title} responded ${addRes.status}: ${await addRes.text()}`);

  await sheetsUpdateValues(token, sheetId, `${title}!A1`, [headerRow]);
}

module.exports = {
  sheetsAccessToken,
  columnLetter,
  sheetsGetValues,
  sheetsUpdateValues,
  sheetsAppendValues,
  sheetsClearValues,
  getSpreadsheetMeta,
  ensureSheetTab,
};
