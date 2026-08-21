/**
 * LapLog backend — Google Apps Script Web App.
 * Sheet = database. Deploy as Web App (Execute as: Me, Access: Anyone).
 * Frontend sends a Google Sign-In ID token with every request; this file
 * verifies it against Google and checks the signed-in email against
 * ALLOWED_EMAILS before reading or writing anything.
 */

const GOOGLE_CLIENT_ID = 'PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE.apps.googleusercontent.com'; // must match CLIENT_ID in the frontend's config.js
const ALLOWED_EMAILS = ['inbaelee@gmail.com', 'carenkang@gmail.com'];
const SHEET_NAME = 'WeeklyLogs';

const COLUMNS = [
  'weekKey', 'startDate',
  'uphillWalk', 'slowJog', 'strength',
  'steps_mon', 'steps_tue', 'steps_wed', 'steps_thu', 'steps_fri', 'steps_sat', 'steps_sun',
  'padel', 'golf', 'restDay',
  'updatedAt'
];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMNS);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function rowToObject_(row) {
  const obj = {};
  COLUMNS.forEach((key, i) => { obj[key] = row[i]; });
  return obj;
}

/**
 * Verifies a Google ID token against Google's tokeninfo endpoint. Returns
 * { email } on success, or { error, ...detail } describing exactly why it
 * was rejected — useful for debugging misconfigured client IDs/allowlists,
 * and not sensitive to expose (worst case it confirms a client ID mismatch).
 */
function verifyIdToken_(idToken) {
  if (!idToken) return { error: 'missing_token' };
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) {
      return { error: 'invalid_token', responseCode: res.getResponseCode(), body: res.getContentText() };
    }
    const payload = JSON.parse(res.getContentText());
    if (payload.aud !== GOOGLE_CLIENT_ID) {
      return { error: 'client_id_mismatch', tokenAud: payload.aud, expected: GOOGLE_CLIENT_ID };
    }
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      return { error: 'email_not_verified', email: payload.email };
    }
    if (ALLOWED_EMAILS.indexOf(payload.email) === -1) {
      return { error: 'email_not_allowlisted', email: payload.email };
    }
    return { email: payload.email };
  } catch (err) {
    return { error: 'exception', message: String(err) };
  }
}

function doGet(e) {
  const auth = verifyIdToken_(e.parameter.id_token);
  if (!auth.email) {
    return json_(Object.assign({ ok: false }, auth));
  }
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1).filter(r => r[0]); // skip header, skip blanks
  const weeks = rows.map(rowToObject_);
  return json_({ ok: true, weeks });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }

  const auth = verifyIdToken_(body.id_token);
  if (!auth.email) {
    return json_(Object.assign({ ok: false }, auth));
  }

  const week = body.week;
  if (!week || !week.weekKey) {
    return json_({ ok: false, error: 'missing_weekKey' });
  }

  const sheet = getSheet_();
  const range = sheet.getDataRange();
  const values = range.getValues();

  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === week.weekKey) {
      rowIndex = i + 1; // 1-indexed sheet row
      break;
    }
  }

  week.updatedAt = new Date().toISOString();
  const rowValues = COLUMNS.map(key => week[key] !== undefined ? week[key] : '');

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
  } else {
    sheet.getRange(rowIndex, 1, 1, COLUMNS.length).setValues([rowValues]);
  }

  return json_({ ok: true, week });
}
