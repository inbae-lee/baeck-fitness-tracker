#!/usr/bin/env node
/**
 * One-off data patch: every workout type now requires min >= 1x/week (0 is
 * never allowed — see lib/categories.js's clampMin), but rows created
 * before that rule (e.g. Padel/Golf, migrated with min: 0) still have
 * min: 0 sitting in the CategoryDefs sheet. This bumps any such row up to
 * min: 1 directly, without going through the app.
 *
 * Usage:
 *   npx vercel env pull .env.migration --environment=production
 *   node scripts/apply-service-account-key.js /path/to/service-account.json .env.migration   # if GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is a Sensitive var
 *   node scripts/fix-category-min-floor.js --dry-run
 *   node scripts/fix-category-min-floor.js            # drop --dry-run to actually write
 *
 * Safe to re-run — only rewrites rows currently below the floor.
 */

require('../lib/envFile').loadDefaultEnvFile('.env.migration');

const { sheetsAccessToken, columnLetter, sheetsUpdateValues } = require('../lib/sheets');
const { DEFS_SHEET, DEFS_COLUMNS, getAllCategoryRows } = require('../lib/categories');

const DRY_RUN = process.argv.includes('--dry-run');
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const MIN_COL = DEFS_COLUMNS.indexOf('min');
const MIN_FLOOR = 1;

async function main() {
  console.log(DRY_RUN ? '--- DRY RUN (no writes will be made) ---' : '--- LIVE RUN ---');
  const token = await sheetsAccessToken();
  const rows = await getAllCategoryRows(token);

  const toFix = [];
  for (let i = 1; i < rows.length; i++) {
    const min = Number(rows[i][MIN_COL]);
    if (!isNaN(min) && min < MIN_FLOOR) toFix.push({ rowNum: i + 1, email: rows[i][0], id: rows[i][1], oldMin: min });
  }

  if (toFix.length === 0) {
    console.log('No CategoryDefs rows below the min floor — nothing to do.');
    return;
  }

  console.log(`Found ${toFix.length} row(s) below min ${MIN_FLOOR}:`);
  toFix.forEach(r => console.log(`  ${r.email} / category ${r.id}: min ${r.oldMin} -> ${MIN_FLOOR}`));

  if (DRY_RUN) {
    console.log('\nDry run complete — no writes made. Re-run without --dry-run to apply.');
    return;
  }

  for (const r of toFix) {
    const range = `${DEFS_SHEET}!${columnLetter(MIN_COL)}${r.rowNum}`;
    await sheetsUpdateValues(token, SHEET_ID, range, [[MIN_FLOOR]]);
  }
  console.log(`\nUpdated ${toFix.length} row(s).`);
}

main().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
