/**
 * UserSettings — one row per email, for account-level settings that aren't
 * tied to a specific workout category. Currently just the weekly minimum
 * for the fixed Daily Steps row (steps_mon...steps_sun in WeeklyLogs),
 * which — unlike CategoryDefs entries — isn't user-creatable/removable, so
 * it doesn't belong in that sheet.
 */

const {
  columnLetter, sheetsGetValues, sheetsUpdateValues, sheetsAppendValues, ensureSheetTab,
} = require('./sheets');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SETTINGS_SHEET = 'UserSettings';
const SETTINGS_COLUMNS = ['email', 'stepsMin', 'updatedAt'];
const EMAIL_COL = SETTINGS_COLUMNS.indexOf('email');
const RANGE = `${SETTINGS_SHEET}!A:${columnLetter(SETTINGS_COLUMNS.length - 1)}`;

const DEFAULT_STEPS_MIN = 7;
const STEPS_MIN_FLOOR = 1;
const STEPS_MIN_CEIL = 7; // there are only 7 days in a week

async function ensureTab(token) {
  await ensureSheetTab(token, SHEET_ID, SETTINGS_SHEET, SETTINGS_COLUMNS);
}

async function getUserSettings(token, email) {
  const rows = await sheetsGetValues(token, SHEET_ID, RANGE);
  const row = rows.slice(1).find(r => r[EMAIL_COL] === email);
  if (!row) return { stepsMin: DEFAULT_STEPS_MIN };
  const stepsMin = Number(row[SETTINGS_COLUMNS.indexOf('stepsMin')]);
  return { stepsMin: isNaN(stepsMin) ? DEFAULT_STEPS_MIN : stepsMin };
}

async function upsertUserSettings(token, email, settings) {
  const rows = await sheetsGetValues(token, SHEET_ID, RANGE);
  const now = new Date().toISOString();
  const rawStepsMin = Number(settings.stepsMin);
  const stepsMin = Math.max(STEPS_MIN_FLOOR, Math.min(STEPS_MIN_CEIL, isNaN(rawStepsMin) ? DEFAULT_STEPS_MIN : rawStepsMin));
  const rowValues = [email, stepsMin, now];

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][EMAIL_COL] === email) { rowIndex = i + 1; break; }
  }
  if (rowIndex === -1) {
    await sheetsAppendValues(token, SHEET_ID, `${SETTINGS_SHEET}!A1`, [rowValues]);
  } else {
    const range = `${SETTINGS_SHEET}!A${rowIndex}:${columnLetter(SETTINGS_COLUMNS.length - 1)}${rowIndex}`;
    await sheetsUpdateValues(token, SHEET_ID, range, [rowValues]);
  }
  return { stepsMin };
}

module.exports = { DEFAULT_STEPS_MIN, STEPS_MIN_FLOOR, STEPS_MIN_CEIL, ensureTab, getUserSettings, upsertUserSettings };
