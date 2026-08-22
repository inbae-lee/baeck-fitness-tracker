'use strict';

const DEFAULT_CATEGORIES = [
  { key: 'uphillWalk', label: 'Uphill Walk', unit: '30min · min 1×/wk', min: 1 },
  { key: 'slowJog', label: 'Slow Jogging', unit: '3KM · min 1×/wk', min: 1 },
  { key: 'strength', label: 'Strength Training', unit: '45min · min 2×/wk', min: 2 },
  { key: 'padel', label: 'Padel', unit: '1H+', min: 0 },
  { key: 'golf', label: 'Golf Practice', unit: '30min+', min: 0 },
];

// Mutable, user-editable copy of DEFAULT_CATEGORIES — labels, subtext, and
// weekly minimums can be changed from the Training settings screen and are
// persisted per-account (see loadCategories/saveCategories below).
let CATEGORIES = DEFAULT_CATEGORIES.map(c => ({ ...c }));

const DAY_SUFFIXES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Every row of the This Week table — workout categories plus the
// daily-steps and full-rest-day rows — sharing one day-selectable grid
// instead of categories using a separate +/- counter. A function (not a
// const) because CATEGORIES can be edited from settings after this file
// first evaluates.
function trackedRows() {
  return [
    ...CATEGORIES,
    { key: 'steps', label: 'Daily Steps', unit: '8,000+ steps', min: 0 },
    { key: 'rest', label: 'Full Rest Day', unit: '', min: 1 },
  ];
}

const STEP_DAYS = [
  { key: 'steps_mon', label: 'M' },
  { key: 'steps_tue', label: 'T' },
  { key: 'steps_wed', label: 'W' },
  { key: 'steps_thu', label: 'T' },
  { key: 'steps_fri', label: 'F' },
  { key: 'steps_sat', label: 'S' },
  { key: 'steps_sun', label: 'S' },
];

const REST_DAYS = [
  { key: 'rest_mon', label: 'M' },
  { key: 'rest_tue', label: 'T' },
  { key: 'rest_wed', label: 'W' },
  { key: 'rest_thu', label: 'T' },
  { key: 'rest_fri', label: 'F' },
  { key: 'rest_sat', label: 'S' },
  { key: 'rest_sun', label: 'S' },
];

const STORAGE_KEY = 'laplog:weeks';
const API_URL = '/api/weeks';

// ---------- date helpers ----------

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- state ----------

let weeks = {}; // weekKey -> week object, scoped to currentEmail
let currentView = 'week';
let openHistoryKey = null;
let currentEmail = null;

function emptyWeek(weekKey, startDate) {
  const w = { weekKey, startDate: startDate.toISOString().slice(0, 10) };
  trackedRows().forEach(row => {
    DAY_SUFFIXES.forEach(sfx => { w[`${row.key}_${sfx}`] = 0; });
  });
  return w;
}

function currentWeekKey() {
  return isoWeekKey(new Date());
}

function getOrCreateCurrentWeek() {
  const key = currentWeekKey();
  if (!weeks[key]) {
    weeks[key] = emptyWeek(key, getMonday(new Date()));
  }
  return weeks[key];
}

// Local cache is namespaced per signed-in email so two people sharing a
// device (or a browser profile) never see or overwrite each other's data,
// even before the server round-trip confirms who's signed in.
function storageKeyForEmail(email) {
  return `${STORAGE_KEY}:${email}`;
}

function loadLocal() {
  if (!currentEmail) { weeks = {}; return; }
  try {
    const raw = localStorage.getItem(storageKeyForEmail(currentEmail));
    weeks = raw ? JSON.parse(raw) : {};
  } catch (e) {
    weeks = {};
  }
}

function saveLocal() {
  if (!currentEmail) return;
  localStorage.setItem(storageKeyForEmail(currentEmail), JSON.stringify(weeks));
}

const CATEGORIES_STORAGE_KEY = 'laplog:categories';

function categoriesStorageKeyForEmail(email) {
  return `${CATEGORIES_STORAGE_KEY}:${email}`;
}

// Categories start from DEFAULT_CATEGORIES and have any saved edits
// (label/unit/min) applied on top, matched by key — so a later app update
// that changes a default doesn't get silently clobbered by an unrelated
// saved field, and a category present in defaults but missing from an old
// save still shows up.
function loadCategories() {
  CATEGORIES = DEFAULT_CATEGORIES.map(c => ({ ...c }));
  if (!currentEmail) return;
  try {
    const raw = localStorage.getItem(categoriesStorageKeyForEmail(currentEmail));
    if (!raw) return;
    const saved = JSON.parse(raw);
    CATEGORIES.forEach(cat => {
      const override = saved.find(s => s.key === cat.key);
      if (!override) return;
      if (typeof override.label === 'string') cat.label = override.label;
      if (typeof override.unit === 'string') cat.unit = override.unit;
      if (typeof override.min === 'number') cat.min = override.min;
    });
  } catch (e) { /* ignore */ }
}

function saveCategories() {
  if (!currentEmail) return;
  localStorage.setItem(categoriesStorageKeyForEmail(currentEmail), JSON.stringify(CATEGORIES));
}

// ---------- sync ----------

const syncStatusEl = () => document.getElementById('syncStatus');

// Rendered as a colored dot (green/yellow/red via the cls class) rather than
// text, to save space next to the email on narrow screens — the full text
// is still available as a tooltip.
function setSyncStatus(text, cls) {
  const el = syncStatusEl();
  if (!el) return;
  el.title = text || 'Sync status';
  el.className = 'sync-status' + (cls ? ' ' + cls : '');
}

const AUTH_ERRORS = new Set([
  'missing_token', 'invalid_token', 'client_id_mismatch', 'email_not_verified', 'email_not_allowlisted',
]);

function authErrorMessage(data) {
  switch (data.error) {
    case 'client_id_mismatch':
      return `Client ID mismatch — frontend config.js and Vercel's GOOGLE_CLIENT_ID env var don't match.`;
    case 'email_not_allowlisted':
      return `${data.email || 'This account'} is not in the ALLOWED_EMAILS env var.`;
    case 'email_not_verified':
      return `${data.email || 'This account'}'s email isn't verified by Google.`;
    case 'invalid_token':
      return 'Google rejected the sign-in token — try signing in again.';
    case 'missing_token':
      return 'No sign-in token was sent — try signing in again.';
    default:
      return 'This Google account is not authorized for baeck-fitness-tracker.';
  }
}

async function fetchFromServer() {
  if (!idToken) {
    setSyncStatus('offline (not signed in)', 'error');
    return;
  }
  setSyncStatus('syncing…', 'syncing');
  try {
    const url = `${API_URL}?id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) {
      if (AUTH_ERRORS.has(data.error)) return signOut(authErrorMessage(data));
      throw new Error(data.error || 'fetch_failed');
    }
    let changed = false;
    data.weeks.forEach(w => {
      const local = weeks[w.weekKey];
      if (!local || !local.updatedAt || (w.updatedAt && w.updatedAt > local.updatedAt)) {
        weeks[w.weekKey] = w;
        changed = true;
      }
    });
    saveLocal();
    setSyncStatus('synced', '');
    // Skip the re-render when nothing actually changed: render() tears down
    // and rebuilds the whole view, and fetchFromServer runs on the 'online'
    // event, which fires often on phones (wifi/cellular handoff, lock/
    // unlock). Rebuilding the DOM under a finger mid-tap makes the tap land
    // on nothing, or on whatever's now at those coordinates.
    if (changed) render();
  } catch (e) {
    setSyncStatus('offline', 'error');
  }
}

// Bumped on every local edit so an in-flight push can tell, once its
// response comes back, whether a newer edit happened while it was in
// flight — Sheets round-trips (OAuth + GET + PUT/append) can take
// 1-3+ seconds on mobile, plenty of time for another tap to land first.
let saveVersion = 0;
let pendingSave = null;
function queueSave(weekKey) {
  saveLocal();
  setSyncStatus('pending…', 'pending');
  const version = ++saveVersion;
  clearTimeout(pendingSave);
  pendingSave = setTimeout(() => pushWeek(weekKey, version), 1000);
}

async function pushWeek(weekKey, version) {
  if (!idToken) return;
  const week = weeks[weekKey];
  if (!week) return;
  setSyncStatus('saving…', 'syncing');
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken, week }),
    });
    const data = await res.json();
    if (!data.ok) {
      if (AUTH_ERRORS.has(data.error)) return signOut(authErrorMessage(data));
      throw new Error(data.error || 'save_failed');
    }
    if (version === saveVersion) {
      // No edits happened while this request was in flight — the server's
      // copy is authoritative (carries its own updatedAt/email).
      weeks[weekKey] = data.week;
    } else if (weeks[weekKey]) {
      // A newer edit landed while this request was in flight. Adopting
      // data.week here would clobber that edit (it reflects the older
      // snapshot this request sent). Leave local state alone — the newer
      // edit already has its own pushWeek queued and will sync it.
      weeks[weekKey].updatedAt = data.week.updatedAt;
    }
    saveLocal();
    setSyncStatus('synced', '');
  } catch (e) {
    setSyncStatus('save failed — will retry', 'error');
  }
}

// ---------- render: This Week ----------

// Sums a row's 7 day cells. Weeks logged before categories became
// day-selectable only have a single running-count field under row.key (e.g.
// week.uphillWalk = 3) — fall back to that when no day data exists yet, so
// history/monthly for those older weeks keeps showing the right total.
function rowTotal(row, week) {
  let sum = 0;
  let hasDayData = false;
  DAY_SUFFIXES.forEach(sfx => {
    const v = week[`${row.key}_${sfx}`];
    if (v !== undefined && v !== null && v !== '') {
      hasDayData = true;
      sum += Number(v) || 0;
    }
  });
  if (hasDayData) return sum;
  return Number(week[row.key]) || 0;
}

function meetsMin(row, week) {
  return row.min > 0 && rowTotal(row, week) >= row.min;
}

// Each category/day/toggle is worth points if its threshold is met; percent
// is earned/possible across all of them. Threshold is the category's stated
// minimum, or 1 for categories with no minimum ("did it at all" counts).
function weeklyProgressPercent(week) {
  let earned = 0;
  let possible = 0;

  CATEGORIES.forEach(cat => {
    const threshold = Math.max(cat.min, 1);
    possible += threshold;
    if (rowTotal(cat, week) >= threshold) earned += threshold;
  });
  STEP_DAYS.forEach(d => {
    possible += 1;
    if (week[d.key]) earned += 1;
  });
  possible += 1; // full rest day — worth 1 point regardless of how many days are picked
  if (REST_DAYS.some(d => week[d.key])) earned += 1;

  return Math.round((earned / possible) * 100);
}

// Static for now (today's date, week number, weekly progress); the natural
// place to add pulled-in data later (e.g. weather) without disturbing the
// Training tile.
function renderInfoCard(week) {
  const card = document.createElement('div');
  card.className = 'card info-card';

  const today = new Date();
  const dateLabel = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  card.innerHTML = `
    <div class="info-grid">
      <div class="info-item">
        <span class="info-value">${dateLabel}</span>
        <span class="info-label">Today</span>
      </div>
    </div>
    <div class="info-progress">Weekly Progress: ${weeklyProgressPercent(week)}%</div>
  `;
  return card;
}

function renderWeekView() {
  const week = getOrCreateCurrentWeek();
  const app = document.getElementById('app');
  const wrap = document.createElement('div');

  const summary = document.createElement('div');
  summary.className = 'week-summary';
  const weekNum = parseInt(currentWeekKey().split('-W')[1], 10);
  summary.textContent = `Week of ${fmtDate(week.startDate)} (wk${weekNum})`;
  wrap.appendChild(summary);

  wrap.appendChild(renderInfoCard(week));
  wrap.appendChild(renderTrainingTable(week));

  app.replaceChildren(wrap);
}

function toggleDay(rowKey, dayIdx) {
  const w = getOrCreateCurrentWeek();
  const key = `${rowKey}_${DAY_SUFFIXES[dayIdx]}`;
  w[key] = w[key] ? 0 : 1;
  queueSave(w.weekKey);
  renderWeekView();
}

// One grid for every tracked row (workout categories, daily steps, full
// rest day): 1st column = row label, next 7 = tap-to-toggle days, last =
// this week's count. Cells are appended in row-major order and rely on
// grid-table's fixed 9-column template to wrap into rows — see .grid-table.
function renderTrainingTable(week) {
  const card = document.createElement('div');
  card.className = 'card table-card';

  const header = document.createElement('div');
  header.className = 'table-card-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Training';
  const gearBtn = document.createElement('button');
  gearBtn.type = 'button';
  gearBtn.className = 'settings-gear-btn';
  gearBtn.setAttribute('aria-label', 'Training settings');
  gearBtn.innerHTML = GEAR_ICON_SVG;
  gearBtn.addEventListener('click', openSettings);
  header.appendChild(h2);
  header.appendChild(gearBtn);
  card.appendChild(header);

  const table = document.createElement('div');
  table.className = 'grid-table';

  table.appendChild(elFromHTML('<div class="gt-cell gt-head gt-label"></div>'));
  DAY_LABELS.forEach(l => table.appendChild(elFromHTML(`<div class="gt-cell gt-head">${l}</div>`)));
  table.appendChild(elFromHTML('<div class="gt-cell gt-head gt-total">Tot</div>'));

  trackedRows().forEach(row => {
    const total = rowTotal(row, week);
    const met = meetsMin(row, week);

    const labelCell = document.createElement('div');
    labelCell.className = 'gt-cell gt-label';
    labelCell.innerHTML = `<span class="gt-title">${escapeHtml(row.label)}</span>${row.unit ? `<span class="gt-unit">${escapeHtml(row.unit)}</span>` : ''}`;
    table.appendChild(labelCell);

    DAY_SUFFIXES.forEach((sfx, i) => {
      const key = `${row.key}_${sfx}`;
      const btn = document.createElement('button');
      btn.className = 'gt-cell gt-toggle' + (week[key] ? ' done' : '');
      btn.setAttribute('aria-label', `${row.label} ${DAY_LABELS[i]}`);
      btn.setAttribute('aria-pressed', week[key] ? 'true' : 'false');
      btn.addEventListener('click', () => toggleDay(row.key, i));
      table.appendChild(btn);
    });

    const totalCell = document.createElement('div');
    totalCell.className = 'gt-cell gt-total' + (met ? ' met' : '');
    totalCell.textContent = total;
    table.appendChild(totalCell);
  });

  card.appendChild(table);
  return card;
}

// ---------- render: Settings ----------

const GEAR_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

const MIN_PER_WEEK_MAX = 7;

function openSettings() {
  document.getElementById('settingsOverlay').hidden = false;
  renderSettings();
}

function closeSettings() {
  document.getElementById('settingsOverlay').hidden = true;
}

// Applies an edit from a settings text field and keeps the This Week table
// in sync, without touching the settings screen's own DOM — re-rendering
// settings on every keystroke would blow away focus/cursor position.
function updateCategoryField(key, field, value) {
  const cat = CATEGORIES.find(c => c.key === key);
  if (!cat) return;
  cat[field] = value;
  saveCategories();
  if (currentView === 'week') renderWeekView();
}

function renderSettings() {
  const body = document.getElementById('settingsBody');
  const wrap = document.createElement('div');
  CATEGORIES.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'card settings-item';
    item.innerHTML = `
      <label class="settings-label">Name</label>
      <input class="settings-input settings-input-title" type="text" value="${escapeHtml(cat.label)}" data-key="${cat.key}" data-field="label" />
      <label class="settings-label">Details</label>
      <input class="settings-input settings-input-sub" type="text" value="${escapeHtml(cat.unit)}" data-key="${cat.key}" data-field="unit" />
      <label class="settings-label">Times per week</label>
      <div class="stepper" data-key="${cat.key}">
        <button type="button" class="stepper-btn" data-dir="-1" aria-label="Decrease">−</button>
        <span class="stepper-value">${cat.min}</span>
        <button type="button" class="stepper-btn" data-dir="1" aria-label="Increase">+</button>
      </div>
    `;
    wrap.appendChild(item);
  });
  body.replaceChildren(wrap);
}

function initSettings() {
  document.getElementById('settingsBackBtn').addEventListener('click', closeSettings);

  const body = document.getElementById('settingsBody');
  body.addEventListener('input', (e) => {
    const input = e.target.closest('.settings-input');
    if (!input) return;
    updateCategoryField(input.dataset.key, input.dataset.field, input.value);
  });
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;
    const stepper = btn.closest('.stepper');
    const cat = CATEGORIES.find(c => c.key === stepper.dataset.key);
    if (!cat) return;
    const dir = parseInt(btn.dataset.dir, 10);
    cat.min = Math.max(0, Math.min(MIN_PER_WEEK_MAX, (cat.min || 0) + dir));
    stepper.querySelector('.stepper-value').textContent = cat.min;
    saveCategories();
    if (currentView === 'week') renderWeekView();
  });
}

// ---------- render: History ----------

function sortedWeekKeys(excludeCurrent) {
  const cur = currentWeekKey();
  return Object.keys(weeks)
    .filter(k => !excludeCurrent || k !== cur)
    .sort((a, b) => b.localeCompare(a));
}

function renderHistoryView() {
  const app = document.getElementById('app');
  const keys = sortedWeekKeys(true);

  if (keys.length === 0) {
    app.replaceChildren(elFromHTML('<div class="empty-state">No past weeks yet — history appears here once a new week starts.</div>'));
    return;
  }

  const wrap = document.createElement('div');
  keys.forEach(key => {
    const week = weeks[key];
    const card = document.createElement('div');
    card.className = 'card history-card' + (openHistoryKey === key ? ' open' : '');

    const dots = CATEGORIES.map(cat => `<span class="dot ${meetsMin(cat, week) ? 'met' : ''}"></span>`).join('');
    const stepsDone = STEP_DAYS.filter(d => week[d.key]).length;
    const restDaysDone = REST_DAYS.filter(d => week[d.key]).length;

    card.innerHTML = `
      <div class="history-card-header">
        <div class="row-label">
          <span class="row-title">${key}</span>
          <span class="row-unit">Week of ${fmtDate(week.startDate)}</span>
        </div>
        <span class="row-unit">${stepsDone}/7 steps</span>
      </div>
      <div class="status-dots">${dots}</div>
      <div class="history-detail">
        ${CATEGORIES.map(cat => `<div class="detail-line"><span>${escapeHtml(cat.label)}</span><b>${rowTotal(cat, week)}${cat.min ? ' / min ' + cat.min : ''}</b></div>`).join('')}
        <div class="detail-line"><span>Daily Steps</span><b>${stepsDone}/7</b></div>
        <div class="detail-line"><span>Rest Days</span><b>${restDaysDone}/7 / min 1</b></div>
      </div>
    `;
    card.addEventListener('click', () => {
      openHistoryKey = openHistoryKey === key ? null : key;
      renderHistoryView();
    });
    wrap.appendChild(card);
  });
  app.replaceChildren(wrap);
}

// Category label/unit are user-editable free text (see settings) and get
// interpolated into innerHTML in a few places below — escape so a saved
// value containing e.g. `<` can't break markup.
const ESCAPE_HTML_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ESCAPE_HTML_MAP[c]);
}

function elFromHTML(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

// ---------- render: Monthly ----------

function monthKeyFromStartDate(startDate) {
  return startDate.slice(0, 7); // YYYY-MM
}

function renderMonthlyView() {
  const app = document.getElementById('app');
  const keys = sortedWeekKeys(false);

  if (keys.length === 0) {
    app.replaceChildren(elFromHTML('<div class="empty-state">No data yet.</div>'));
    return;
  }

  const months = {};
  keys.forEach(key => {
    const w = weeks[key];
    const mKey = monthKeyFromStartDate(w.startDate);
    if (!months[mKey]) {
      months[mKey] = { weeks: [], totals: {} };
      CATEGORIES.forEach(c => { months[mKey].totals[c.key] = 0; });
      months[mKey].totals.stepsMet = 0;
      months[mKey].totals.stepsTotal = 0;
      months[mKey].totals.restDays = 0;
    }
    months[mKey].weeks.push(w);
    CATEGORIES.forEach(c => { months[mKey].totals[c.key] += rowTotal(c, w); });
    STEP_DAYS.forEach(d => {
      months[mKey].totals.stepsTotal += 1;
      if (w[d.key]) months[mKey].totals.stepsMet += 1;
    });
    REST_DAYS.forEach(d => { if (w[d.key]) months[mKey].totals.restDays += 1; });
  });

  const wrap = document.createElement('div');
  Object.keys(months).sort((a, b) => b.localeCompare(a)).forEach(mKey => {
    const m = months[mKey];
    const label = new Date(mKey + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const stepPct = m.totals.stepsTotal ? Math.round((m.totals.stepsMet / m.totals.stepsTotal) * 100) : 0;

    const card = document.createElement('div');
    card.className = 'card month-card';
    card.innerHTML = `
      <h3>${label}</h3>
      <div class="row-unit">${m.weeks.length} week${m.weeks.length > 1 ? 's' : ''} logged</div>
      ${CATEGORIES.map(c => `<div class="month-stat"><span>${escapeHtml(c.label)}</span><b>${m.totals[c.key]}</b></div>`).join('')}
      <div class="month-stat"><span>Step compliance</span><b>${stepPct}%</b></div>
      <div class="month-stat"><span>Rest days</span><b>${m.totals.restDays}</b></div>
    `;
    wrap.appendChild(card);
  });
  app.replaceChildren(wrap);
}

// ---------- nav ----------

function render() {
  if (currentView === 'week') renderWeekView();
  else if (currentView === 'history') renderHistoryView();
  else renderMonthlyView();
}

function initTabs() {
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    render();
  });
  document.getElementById('signOutBtn').addEventListener('click', () => signOut(''));
  document.getElementById('authRetryBtn').addEventListener('click', initGoogleSignIn);
  initSettings();
}

// ---------- auth ----------

const ID_TOKEN_KEY = 'laplog:idToken';
let idToken = null;

// Decodes the JWT payload without verifying it — server-side verification
// (api/weeks.js) is what actually establishes identity; this is only used
// to namespace the local cache under the right email before that round-trip
// completes.
function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch (e) {
    return null;
  }
}

function showAuthGate(message, isError) {
  document.getElementById('authGate').hidden = false;
  document.getElementById('appRoot').hidden = true;
  const err = document.getElementById('authError');
  err.textContent = message || '';
  err.classList.toggle('is-error', !!isError);
}

function showApp() {
  document.getElementById('authGate').hidden = true;
  document.getElementById('appRoot').hidden = false;
  document.getElementById('userEmail').textContent = currentEmail || '';
}

function signOut(message) {
  idToken = null;
  currentEmail = null;
  weeks = {};
  CATEGORIES = DEFAULT_CATEGORIES.map(c => ({ ...c }));
  closeSettings();
  sessionStorage.removeItem(ID_TOKEN_KEY);
  document.getElementById('userEmail').textContent = '';
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  document.getElementById('authRetryBtn').hidden = true;
  showAuthGate(message, !!message);
}

async function afterSignIn() {
  const payload = decodeJwtPayload(idToken);
  currentEmail = payload && payload.email;
  if (!currentEmail) return signOut('Could not read the signed-in account from the sign-in token — try again.');

  loadLocal();
  loadCategories();
  showApp();
  render();
  await fetchFromServer();
}

function handleCredentialResponse(response) {
  idToken = response.credential;
  sessionStorage.setItem(ID_TOKEN_KEY, idToken);
  afterSignIn();
}

function waitForGoogleLibrary(timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out loading accounts.google.com/gsi/client'));
      setTimeout(poll, 200);
    })();
  });
}

async function initGoogleSignIn() {
  if (!APP_CONFIG.CLIENT_ID || APP_CONFIG.CLIENT_ID.startsWith('PASTE_')) {
    showAuthGate('Google sign-in is not configured yet (missing CLIENT_ID in config.js).', true);
    return;
  }

  const retryBtn = document.getElementById('authRetryBtn');
  retryBtn.hidden = true;
  showAuthGate('Loading Google Sign-In…', false);

  try {
    await waitForGoogleLibrary(8000);
  } catch (e) {
    showAuthGate("Couldn't load Google Sign-In — check your connection, or an ad/privacy blocker may be blocking accounts.google.com.", true);
    retryBtn.hidden = false;
    return;
  }

  try {
    google.accounts.id.initialize({
      client_id: APP_CONFIG.CLIENT_ID,
      callback: handleCredentialResponse,
    });
    google.accounts.id.renderButton(
      document.getElementById('googleSignInButton'),
      { theme: 'outline', size: 'large', text: 'signin_with' }
    );
  } catch (e) {
    showAuthGate('Google Sign-In failed to start: ' + e.message, true);
    retryBtn.hidden = false;
    return;
  }

  showAuthGate('', false);

  const saved = sessionStorage.getItem(ID_TOKEN_KEY);
  if (saved) {
    idToken = saved;
    afterSignIn();
  } else {
    try {
      google.accounts.id.prompt(); // One Tap; best-effort, the rendered button always works even if this silently declines
    } catch (e) { /* ignore */ }
  }
}

// ---------- init ----------

initTabs();
showAuthGate('');

window.addEventListener('load', initGoogleSignIn);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

window.addEventListener('online', () => { if (idToken) fetchFromServer(); });
