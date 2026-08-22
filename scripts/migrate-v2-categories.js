#!/usr/bin/env node
/**
 * One-off migration: wide/fixed-column WeeklyLogs (one column per hardcoded
 * workout category, e.g. uphillWalk_mon...golf_sun) -> the v2 schema where
 * workout types are user-definable, numbered per email, and stored as rows
 * in CategoryDefs/CategoryEntries instead of columns in WeeklyLogs.
 *
 * This is a TEMPLATE for future schema migrations as much as it is this one
 * — the shape (read old rows with a hardcoded OLD_COLUMNS layout, transform
 * in memory, write new sheets, dry-run first) is meant to be copied for the
 * next big rework rather than run more than once.
 *
 * Usage:
 *   GOOGLE_SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_EMAIL=... \
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=... node scripts/migrate-v2-categories.js --dry-run
 *
 *   (drop --dry-run to actually write). Pull real values for those env vars
 *   from Vercel first, e.g. `vercel env pull .env.migration` then
 *   `export $(grep -v '^#' .env.migration | xargs)`.
 *
 * Safe to re-run: WeeklyLogs is only rewritten once (skipped if it's
 * already in the trimmed v2 shape), and CategoryDefs/CategoryEntries writes
 * are skipped per-row if a matching row already exists.
 */

const {
  sheetsAccessToken, columnLetter, sheetsGetValues, sheetsUpdateValues, sheetsClearValues,
  sheetsAppendValues,
} = require('../lib/sheets');
const {
  DEFS_SHEET, DEFS_COLUMNS, ENTRIES_SHEET, ENTRIES_COLUMNS, DAY_SUFFIXES,
  ensureTabs, getAllCategoryRows, getUserEntries,
} = require('../lib/categories');

const DRY_RUN = process.argv.includes('--dry-run');
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const WEEKLY_SHEET = 'WeeklyLogs';

// The pre-migration WeeklyLogs layout (see git history of api/weeks.js).
// Column positions are load-bearing here — do not reorder.
const OLD_COLUMNS = [
  'weekKey', 'email', 'startDate',
  'uphillWalk', 'slowJog', 'strength',
  'steps_mon', 'steps_tue', 'steps_wed', 'steps_thu', 'steps_fri', 'steps_sat', 'steps_sun',
  'padel', 'golf',
  'rest_mon', 'rest_tue', 'rest_wed', 'rest_thu', 'rest_fri', 'rest_sat', 'rest_sun',
  'updatedAt',
  'uphillWalk_mon', 'uphillWalk_tue', 'uphillWalk_wed', 'uphillWalk_thu', 'uphillWalk_fri', 'uphillWalk_sat', 'uphillWalk_sun',
  'slowJog_mon', 'slowJog_tue', 'slowJog_wed', 'slowJog_thu', 'slowJog_fri', 'slowJog_sat', 'slowJog_sun',
  'strength_mon', 'strength_tue', 'strength_wed', 'strength_thu', 'strength_fri', 'strength_sat', 'strength_sun',
  'padel_mon', 'padel_tue', 'padel_wed', 'padel_thu', 'padel_fri', 'padel_sat', 'padel_sun',
  'golf_mon', 'golf_tue', 'golf_wed', 'golf_thu', 'golf_fri', 'golf_sat', 'golf_sun',
];
const OLD_RANGE = `${WEEKLY_SHEET}!A:${columnLetter(OLD_COLUMNS.length - 1)}`;

// New (v2) trimmed WeeklyLogs layout — must match api/weeks.js COLUMNS.
const NEW_COLUMNS = [
  'weekKey', 'email', 'startDate',
  'steps_mon', 'steps_tue', 'steps_wed', 'steps_thu', 'steps_fri', 'steps_sat', 'steps_sun',
  'rest_mon', 'rest_tue', 'rest_wed', 'rest_thu', 'rest_fri', 'rest_sat', 'rest_sun',
  'updatedAt',
];

// Legacy hardcoded categories -> the fixed ids they get for every user.
// Matches DEFAULT_CATEGORIES order in app.js as it stood pre-migration.
const LEGACY_CATEGORIES = [
  { legacyKey: 'uphillWalk', id: 1, label: 'Uphill Walk', unit: '30min · min 1×/wk', min: 1 },
  { legacyKey: 'slowJog', id: 2, label: 'Slow Jogging', unit: '3KM · min 1×/wk', min: 1 },
  { legacyKey: 'strength', id: 3, label: 'Strength Training', unit: '45min · min 2×/wk', min: 2 },
  { legacyKey: 'padel', id: 4, label: 'Padel', unit: '1H+', min: 0 },
  { legacyKey: 'golf', id: 5, label: 'Golf Practice', unit: '30min+', min: 0 },
];

function oldRowToObject(row) {
  const obj = {};
  OLD_COLUMNS.forEach((key, i) => { obj[key] = row[i]; });
  return obj;
}

function log(...args) { console.log(...args); }

async function main() {
  log(DRY_RUN ? '--- DRY RUN (no writes will be made) ---' : '--- LIVE RUN ---');
  const token = await sheetsAccessToken();

  const oldRows = await sheetsGetValues(token, SHEET_ID, OLD_RANGE);
  if (oldRows.length === 0) {
    log('WeeklyLogs is empty — nothing to migrate. Still ensuring CategoryDefs/CategoryEntries tabs exist.');
    if (!DRY_RUN) await ensureTabs(token);
    return;
  }

  const header = oldRows[0];
  const alreadyMigrated = header.length <= NEW_COLUMNS.length && header[3] === 'steps_mon';
  if (alreadyMigrated) {
    log('WeeklyLogs header already matches the v2 trimmed layout — skipping WeeklyLogs rewrite.');
  }

  const dataRows = oldRows.slice(1).filter(r => r[0]).map(oldRowToObject);
  const emails = [...new Set(dataRows.map(r => r.email).filter(Boolean))];
  log(`Found ${dataRows.length} WeeklyLogs rows across ${emails.length} user(s): ${emails.join(', ')}`);

  // ---- CategoryDefs: 5 legacy categories per user, ids 1-5 ----
  const existingDefRows = alreadyMigrated ? [] : await getAllCategoryRows(token).catch(() => []);
  const existingDefKeys = new Set(existingDefRows.map(r => `${r[0]}::${r[1]}`)); // email::id
  const newDefRows = [];
  emails.forEach(email => {
    LEGACY_CATEGORIES.forEach(cat => {
      const key = `${email}::${cat.id}`;
      if (existingDefKeys.has(key)) return; // idempotent re-run
      const now = new Date().toISOString();
      newDefRows.push(DEFS_COLUMNS.map(col => ({
        email, id: cat.id, label: cat.label, unit: cat.unit, min: cat.min,
        sortOrder: cat.id, archived: false, createdAt: now, updatedAt: now,
      }[col])));
    });
  });
  log(`CategoryDefs: ${newDefRows.length} row(s) to create (${existingDefKeys.size} already present).`);

  // ---- CategoryEntries: one row per (weekKey, email, legacy category) that has data ----
  const existingEntriesByEmail = {};
  if (!alreadyMigrated) {
    for (const email of emails) {
      existingEntriesByEmail[email] = await getUserEntries(token, email).catch(() => ({}));
    }
  }
  const newEntryRows = [];
  let aggregateOnlyCount = 0;
  dataRows.forEach(row => {
    LEGACY_CATEGORIES.forEach(cat => {
      const dayVals = DAY_SUFFIXES.map(sfx => row[`${cat.legacyKey}_${sfx}`]);
      const hasDayData = dayVals.some(v => v !== undefined && v !== null && v !== '');
      const alreadyHasEntry = existingEntriesByEmail[row.email]
        && existingEntriesByEmail[row.email][row.weekKey]
        && existingEntriesByEmail[row.email][row.weekKey][cat.id];
      if (alreadyHasEntry) return; // idempotent re-run

      let days;
      if (hasDayData) {
        days = DAY_SUFFIXES.reduce((acc, sfx, i) => { acc[sfx] = dayVals[i] || 0; return acc; }, {});
      } else {
        const total = Number(row[cat.legacyKey]) || 0;
        if (total === 0) return; // nothing to carry over
        // Pre-day-selectable rows only stored a running count, not which
        // days — collapsed onto Monday so the weekly total is preserved.
        // Per-day history for these old weeks is unrecoverable either way.
        aggregateOnlyCount++;
        days = { mon: total, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
      }

      newEntryRows.push(ENTRIES_COLUMNS.map(col => ({
        weekKey: row.weekKey, email: row.email, categoryId: cat.id, ...days,
        updatedAt: row.updatedAt || new Date().toISOString(),
      }[col])));
    });
  });
  log(`CategoryEntries: ${newEntryRows.length} row(s) to create (${aggregateOnlyCount} from pre-day-selectable aggregate-only rows, collapsed onto Monday).`);

  // ---- Trimmed WeeklyLogs rows ----
  const newWeeklyRows = alreadyMigrated ? null : dataRows.map(row => NEW_COLUMNS.map(col => row[col] !== undefined ? row[col] : ''));

  if (DRY_RUN) {
    log('\nSample CategoryDefs row:', newDefRows[0]);
    log('Sample CategoryEntries row:', newEntryRows[0]);
    if (newWeeklyRows) log('Sample trimmed WeeklyLogs row:', newWeeklyRows[0]);
    log('\nDry run complete — no writes made. Re-run without --dry-run to apply.');
    return;
  }

  await ensureTabs(token);

  if (newDefRows.length > 0) {
    const range = `${DEFS_SHEET}!A1:${columnLetter(DEFS_COLUMNS.length - 1)}1`;
    // Append after existing rows rather than overwrite — CategoryDefs may
    // already hold user-created categories (ids > 5) from before this
    // script ran, if the app's already been live on the new API.
    await appendAll(token, DEFS_SHEET, DEFS_COLUMNS.length, newDefRows);
    log(`Wrote ${newDefRows.length} CategoryDefs row(s).`);
  }
  if (newEntryRows.length > 0) {
    await appendAll(token, ENTRIES_SHEET, ENTRIES_COLUMNS.length, newEntryRows);
    log(`Wrote ${newEntryRows.length} CategoryEntries row(s).`);
  }
  if (newWeeklyRows) {
    await sheetsClearValues(token, SHEET_ID, `${WEEKLY_SHEET}!A:${columnLetter(OLD_COLUMNS.length - 1)}`);
    await sheetsUpdateValues(token, SHEET_ID, `${WEEKLY_SHEET}!A1`, [NEW_COLUMNS, ...newWeeklyRows]);
    log(`Rewrote WeeklyLogs with the trimmed v2 header + ${newWeeklyRows.length} row(s).`);
  }

  log('\nMigration complete.');
}

async function appendAll(token, sheetName, numCols, rows) {
  // One append call with all rows batched, not one call per row.
  await sheetsAppendValues(token, SHEET_ID, `${sheetName}!A1`, rows);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
