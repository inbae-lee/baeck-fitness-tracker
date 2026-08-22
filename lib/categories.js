/**
 * CategoryDefs + CategoryEntries — the per-user, user-definable workout
 * types (see CLAUDE.md for the schema rationale). Both sheets are
 * partitioned by an `email` column rather than split into one sheet per
 * user, mirroring WeeklyLogs — row-based partitioning scales fine at this
 * app's size and keeps schema changes to one place.
 *
 * A category's `id` is an integer scoped PER EMAIL (each user numbers their
 * own categories 1, 2, 3… independently) and is assigned server-side, never
 * client-supplied — so two users' category 1 never collide, and category
 * ids act as stable foreign keys into CategoryEntries that survive
 * label/rename edits.
 */

const {
  sheetsAccessToken, columnLetter, sheetsGetValues, sheetsUpdateValues,
  sheetsAppendValues, ensureSheetTab,
} = require('./sheets');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const DEFS_SHEET = 'CategoryDefs';
const DEFS_COLUMNS = ['email', 'id', 'label', 'unit', 'min', 'sortOrder', 'archived', 'createdAt', 'updatedAt'];
const DEFS_EMAIL_COL = DEFS_COLUMNS.indexOf('email');
const DEFS_ID_COL = DEFS_COLUMNS.indexOf('id');
const DEFS_RANGE = `${DEFS_SHEET}!A:${columnLetter(DEFS_COLUMNS.length - 1)}`;

const ENTRIES_SHEET = 'CategoryEntries';
const DAY_SUFFIXES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ENTRIES_COLUMNS = ['weekKey', 'email', 'categoryId', ...DAY_SUFFIXES, 'updatedAt'];
const ENTRIES_WEEK_COL = ENTRIES_COLUMNS.indexOf('weekKey');
const ENTRIES_EMAIL_COL = ENTRIES_COLUMNS.indexOf('email');
const ENTRIES_CATID_COL = ENTRIES_COLUMNS.indexOf('categoryId');
const ENTRIES_RANGE = `${ENTRIES_SHEET}!A:${columnLetter(ENTRIES_COLUMNS.length - 1)}`;

async function ensureTabs(token) {
  await ensureSheetTab(token, SHEET_ID, DEFS_SHEET, DEFS_COLUMNS);
  await ensureSheetTab(token, SHEET_ID, ENTRIES_SHEET, ENTRIES_COLUMNS);
}

function defRowToObject(row) {
  const obj = {};
  DEFS_COLUMNS.forEach((key, i) => { obj[key] = row[i]; });
  obj.id = parseInt(obj.id, 10);
  obj.min = Number(obj.min) || 0;
  obj.sortOrder = Number(obj.sortOrder) || 0;
  obj.archived = obj.archived === 'true' || obj.archived === true;
  return obj;
}

async function getAllCategoryRows(token) {
  return sheetsGetValues(token, SHEET_ID, DEFS_RANGE);
}

/** All categories (including archived) for one user, sorted by sortOrder. */
async function getUserCategories(token, email, opts) {
  const rows = await getAllCategoryRows(token);
  const cats = rows.slice(1)
    .filter(r => r[DEFS_EMAIL_COL] === email && r[DEFS_ID_COL] !== '' && r[DEFS_ID_COL] !== undefined)
    .map(defRowToObject);
  const visible = (opts && opts.includeArchived) ? cats : cats.filter(c => !c.archived);
  return visible.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/**
 * Creates a new category (id === null/undefined) or updates an existing one
 * (matched by email+id). Returns the saved category object.
 */
async function upsertCategory(token, email, category) {
  const rows = await getAllCategoryRows(token);
  const now = new Date().toISOString();

  if (category.id === null || category.id === undefined) {
    const existingIds = rows.slice(1)
      .filter(r => r[DEFS_EMAIL_COL] === email)
      .map(r => parseInt(r[DEFS_ID_COL], 10))
      .filter(n => !isNaN(n));
    const nextId = existingIds.length ? Math.max(...existingIds) + 1 : 1;
    const record = {
      email, id: nextId,
      label: category.label || 'New Workout',
      unit: category.unit || '',
      min: Number(category.min) || 0,
      sortOrder: Number(category.sortOrder) || nextId,
      archived: false,
      createdAt: now, updatedAt: now,
    };
    const rowValues = DEFS_COLUMNS.map(k => (record[k] !== undefined ? record[k] : ''));
    await sheetsAppendValues(token, SHEET_ID, `${DEFS_SHEET}!A1`, [rowValues]);
    return record;
  }

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][DEFS_EMAIL_COL] === email && parseInt(rows[i][DEFS_ID_COL], 10) === category.id) {
      rowIndex = i + 1; // 1-indexed sheet row
      break;
    }
  }
  if (rowIndex === -1) throw new Error('category_not_found');

  const existing = defRowToObject(rows[rowIndex - 1]);
  const record = {
    email, id: category.id,
    label: category.label !== undefined ? category.label : existing.label,
    unit: category.unit !== undefined ? category.unit : existing.unit,
    min: category.min !== undefined ? Number(category.min) : existing.min,
    sortOrder: category.sortOrder !== undefined ? Number(category.sortOrder) : existing.sortOrder,
    archived: category.archived !== undefined ? !!category.archived : existing.archived,
    createdAt: existing.createdAt, updatedAt: now,
  };
  const range = `${DEFS_SHEET}!A${rowIndex}:${columnLetter(DEFS_COLUMNS.length - 1)}${rowIndex}`;
  const rowValues = DEFS_COLUMNS.map(k => (record[k] !== undefined ? record[k] : ''));
  await sheetsUpdateValues(token, SHEET_ID, range, [rowValues]);
  return record;
}

function entryRowToObject(row) {
  const obj = {};
  ENTRIES_COLUMNS.forEach((key, i) => { obj[key] = row[i]; });
  obj.categoryId = parseInt(obj.categoryId, 10);
  return obj;
}

/** All entries for one user, grouped as { [weekKey]: { [categoryId]: {mon..sun} } }. */
async function getUserEntries(token, email) {
  const rows = await sheetsGetValues(token, SHEET_ID, ENTRIES_RANGE);
  const byWeek = {};
  rows.slice(1)
    .filter(r => r[ENTRIES_EMAIL_COL] === email && r[ENTRIES_WEEK_COL])
    .map(entryRowToObject)
    .forEach(e => {
      if (!byWeek[e.weekKey]) byWeek[e.weekKey] = {};
      byWeek[e.weekKey][e.categoryId] = DAY_SUFFIXES.reduce((acc, sfx) => {
        acc[sfx] = e[sfx];
        return acc;
      }, {});
    });
  return byWeek;
}

/**
 * Upserts one (weekKey, email, categoryId) row per entry in `entriesByCatId`
 * ({ [categoryId]: {mon..sun} }). Re-fetches the sheet once up front and
 * batches all appends/updates for this call — cheaper than one round-trip
 * per category when a week touches several of them at once.
 */
async function saveUserEntries(token, email, weekKey, entriesByCatId, updatedAt) {
  const rows = await sheetsGetValues(token, SHEET_ID, ENTRIES_RANGE);
  const catIds = Object.keys(entriesByCatId);
  if (catIds.length === 0) return;

  for (const catIdStr of catIds) {
    const catId = parseInt(catIdStr, 10);
    const days = entriesByCatId[catIdStr];
    const record = { weekKey, email, categoryId: catId, ...days, updatedAt };
    const rowValues = ENTRIES_COLUMNS.map(k => (record[k] !== undefined ? record[k] : ''));

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][ENTRIES_WEEK_COL] === weekKey && rows[i][ENTRIES_EMAIL_COL] === email
        && parseInt(rows[i][ENTRIES_CATID_COL], 10) === catId) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      await sheetsAppendValues(token, SHEET_ID, `${ENTRIES_SHEET}!A1`, [rowValues]);
      // Reflect the append in our in-memory copy so a second category in
      // this same call doesn't also try to append into the same slot.
      rows.push(rowValues);
    } else {
      const range = `${ENTRIES_SHEET}!A${rowIndex}:${columnLetter(ENTRIES_COLUMNS.length - 1)}${rowIndex}`;
      await sheetsUpdateValues(token, SHEET_ID, range, [rowValues]);
      rows[rowIndex - 1] = rowValues;
    }
  }
}

module.exports = {
  DAY_SUFFIXES,
  DEFS_SHEET, DEFS_COLUMNS,
  ENTRIES_SHEET, ENTRIES_COLUMNS,
  ensureTabs,
  getAllCategoryRows,
  getUserCategories, upsertCategory,
  getUserEntries, saveUserEntries,
  sheetsAccessToken,
};
