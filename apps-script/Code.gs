/**
 * LapLog backend — Google Apps Script Web App.
 * Sheet = database. Deploy as Web App (Execute as: Me, Access: Anyone).
 * Frontend calls this URL with a shared SECRET for basic write protection.
 */

const SECRET = 'CHANGE_ME'; // must match SECRET in the frontend's config.js
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

function doGet(e) {
  const secret = e.parameter.secret;
  if (secret !== SECRET) {
    return json_({ ok: false, error: 'unauthorized' });
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

  if (body.secret !== SECRET) {
    return json_({ ok: false, error: 'unauthorized' });
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
