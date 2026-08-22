/**
 * UserSettings — one row per email, for account-level settings that aren't
 * tied to a specific workout category. Currently the weekly minimums for
 * the two fixed rows (Daily Steps, Full Rest Day) in WeeklyLogs — unlike
 * CategoryDefs entries, these aren't user-creatable/removable, so they
 * don't belong in that sheet.
 *
 * `restMin` was added after `updatedAt` (not before) to keep column
 * positions stable for any row already written under the 3-column layout —
 * new columns are always appended at the end, never inserted.
 */

const {
  columnLetter, sheetsGetValues, sheetsUpdateValues, sheetsAppendValues, ensureSheetTab,
} = require('./sheets');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SETTINGS_SHEET = 'UserSettings';
const SETTINGS_COLUMNS = ['email', 'stepsMin', 'updatedAt', 'restMin'];
const EMAIL_COL = SETTINGS_COLUMNS.indexOf('email');
const RANGE = `${SETTINGS_SHEET}!A:${columnLetter(SETTINGS_COLUMNS.length - 1)}`;

const DEFAULT_STEPS_MIN = 7;
const STEPS_MIN_FLOOR = 1;
const STEPS_MIN_CEIL = 7; // there are only 7 days in a week

const DEFAULT_REST_MIN = 1;
const REST_MIN_FLOOR = 1;
const REST_MIN_CEIL = 7;

async function ensureTab(token) {
  await ensureSheetTab(token, SHEET_ID, SETTINGS_SHEET, SETTINGS_COLUMNS);
}

async function getUserSettings(token, email) {
  const rows = await sheetsGetValues(token, SHEET_ID, RANGE);
  const row = rows.slice(1).find(r => r[EMAIL_COL] === email);
  if (!row) return { stepsMin: DEFAULT_STEPS_MIN, restMin: DEFAULT_REST_MIN };
  const stepsMin = Number(row[SETTINGS_COLUMNS.indexOf('stepsMin')]);
  const restMin = Number(row[SETTINGS_COLUMNS.indexOf('restMin')]);
  return {
    stepsMin: isNaN(stepsMin) ? DEFAULT_STEPS_MIN : stepsMin,
    restMin: isNaN(restMin) ? DEFAULT_REST_MIN : restMin,
  };
}

async function upsertUserSettings(token, email, settings) {
  const rows = await sheetsGetValues(token, SHEET_ID, RANGE);
  const now = new Date().toISOString();

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][EMAIL_COL] === email) { rowIndex = i + 1; break; }
  }
  const existing = rowIndex === -1 ? {} : {
    stepsMin: Number(rows[rowIndex - 1][SETTINGS_COLUMNS.indexOf('stepsMin')]),
    restMin: Number(rows[rowIndex - 1][SETTINGS_COLUMNS.indexOf('restMin')]),
  };

  const rawStepsMin = settings.stepsMin !== undefined ? Number(settings.stepsMin) : existing.stepsMin;
  const stepsMin = Math.max(STEPS_MIN_FLOOR, Math.min(STEPS_MIN_CEIL, isNaN(rawStepsMin) ? DEFAULT_STEPS_MIN : rawStepsMin));

  const rawRestMin = settings.restMin !== undefined ? Number(settings.restMin) : existing.restMin;
  const restMin = Math.max(REST_MIN_FLOOR, Math.min(REST_MIN_CEIL, isNaN(rawRestMin) ? DEFAULT_REST_MIN : rawRestMin));

  const record = { email, stepsMin, updatedAt: now, restMin };
  const rowValues = SETTINGS_COLUMNS.map(k => record[k]);

  if (rowIndex === -1) {
    await sheetsAppendValues(token, SHEET_ID, `${SETTINGS_SHEET}!A1`, [rowValues]);
  } else {
    const range = `${SETTINGS_SHEET}!A${rowIndex}:${columnLetter(SETTINGS_COLUMNS.length - 1)}${rowIndex}`;
    await sheetsUpdateValues(token, SHEET_ID, range, [rowValues]);
  }
  return { stepsMin, restMin };
}

module.exports = {
  DEFAULT_STEPS_MIN, STEPS_MIN_FLOOR, STEPS_MIN_CEIL,
  DEFAULT_REST_MIN, REST_MIN_FLOOR, REST_MIN_CEIL,
  ensureTab, getUserSettings, upsertUserSettings,
};
