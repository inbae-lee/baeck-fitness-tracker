'use strict';

const CATEGORIES = [
  { key: 'uphillWalk', label: 'Uphill Walk', unit: '30min · min 1×/wk', min: 1 },
  { key: 'slowJog', label: 'Slow Jogging', unit: '3KM · min 1×/wk', min: 1 },
  { key: 'strength', label: 'Strength Training', unit: '45min · min 2×/wk', min: 2 },
  { key: 'padel', label: 'Padel', unit: '1H+', min: 0 },
  { key: 'golf', label: 'Golf Practice', unit: '30min+', min: 0 },
];

const STEP_DAYS = [
  { key: 'steps_mon', label: 'M' },
  { key: 'steps_tue', label: 'T' },
  { key: 'steps_wed', label: 'W' },
  { key: 'steps_thu', label: 'T' },
  { key: 'steps_fri', label: 'F' },
  { key: 'steps_sat', label: 'S' },
  { key: 'steps_sun', label: 'S' },
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
  CATEGORIES.forEach(c => { w[c.key] = 0; });
  STEP_DAYS.forEach(d => { w[d.key] = 0; });
  w.restDay = 0;
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

// ---------- sync ----------

const syncStatusEl = () => document.getElementById('syncStatus');

function setSyncStatus(text, cls) {
  const el = syncStatusEl();
  if (!el) return;
  el.textContent = text;
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
    data.weeks.forEach(w => {
      const local = weeks[w.weekKey];
      if (!local || !local.updatedAt || (w.updatedAt && w.updatedAt > local.updatedAt)) {
        weeks[w.weekKey] = w;
      }
    });
    saveLocal();
    setSyncStatus('synced', '');
    render();
  } catch (e) {
    setSyncStatus('offline', 'error');
  }
}

let pendingSave = null;
function queueSave(weekKey) {
  saveLocal();
  clearTimeout(pendingSave);
  pendingSave = setTimeout(() => pushWeek(weekKey), 600);
}

async function pushWeek(weekKey) {
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
    weeks[weekKey] = data.week;
    saveLocal();
    setSyncStatus('synced', '');
  } catch (e) {
    setSyncStatus('save failed — will retry', 'error');
  }
}

// ---------- render: This Week ----------

function meetsMin(cat, week) {
  return cat.min > 0 && week[cat.key] >= cat.min;
}

function renderWeekView() {
  const week = getOrCreateCurrentWeek();
  const app = document.getElementById('app');
  const wrap = document.createElement('div');

  const summary = document.createElement('div');
  summary.className = 'week-summary';
  summary.textContent = `Week of ${fmtDate(week.startDate)}`;
  wrap.appendChild(summary);

  const card = document.createElement('div');
  card.className = 'card';
  const h2 = document.createElement('h2');
  h2.textContent = 'Training';
  card.appendChild(h2);

  CATEGORIES.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="row-label">
        <span class="row-title">${cat.label}</span>
        <span class="row-unit">${cat.unit}</span>
      </div>
      <div class="row-right">
        <div class="row-flag">${meetsMin(cat, week) ? '✓ min' : ''}</div>
        <div class="row-control">
          <button class="btn-step minus" aria-label="Decrease">−</button>
          <span class="count-value">${week[cat.key]}</span>
          <button class="btn-step plus" aria-label="Increase">+</button>
        </div>
      </div>
    `;
    row.querySelector('.plus').addEventListener('click', () => {
      week[cat.key]++;
      queueSave(week.weekKey);
      renderWeekView();
    });
    row.querySelector('.minus').addEventListener('click', () => {
      week[cat.key] = Math.max(0, week[cat.key] - 1);
      queueSave(week.weekKey);
      renderWeekView();
    });
    card.appendChild(row);
  });
  wrap.appendChild(card);

  const stepsCard = document.createElement('div');
  stepsCard.className = 'card';
  const stepsTitle = document.createElement('h2');
  const stepsDone = STEP_DAYS.filter(d => week[d.key]).length;
  stepsTitle.textContent = `Daily Steps 8,000+ (${stepsDone}/7)`;
  stepsCard.appendChild(stepsTitle);

  const grid = document.createElement('div');
  grid.className = 'steps-grid';
  STEP_DAYS.forEach(d => {
    const cell = document.createElement('div');
    cell.className = 'step-day';
    cell.innerHTML = `
      <span class="step-day-label">${d.label}</span>
      <button class="step-toggle ${week[d.key] ? 'done' : ''}" aria-label="${d.key}"></button>
    `;
    cell.querySelector('.step-toggle').addEventListener('click', () => {
      week[d.key] = week[d.key] ? 0 : 1;
      queueSave(week.weekKey);
      renderWeekView();
    });
    grid.appendChild(cell);
  });
  stepsCard.appendChild(grid);
  wrap.appendChild(stepsCard);

  const restCard = document.createElement('div');
  restCard.className = 'card';
  restCard.innerHTML = `
    <div class="switch-row">
      <div class="row-label">
        <span class="row-title">Full Rest Day</span>
        <span class="row-unit">1 day a week</span>
      </div>
      <button class="switch ${week.restDay ? 'on' : ''}"></button>
    </div>
  `;
  restCard.querySelector('.switch').addEventListener('click', () => {
    week.restDay = week.restDay ? 0 : 1;
    queueSave(week.weekKey);
    renderWeekView();
  });
  wrap.appendChild(restCard);

  app.replaceChildren(wrap);
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
        ${CATEGORIES.map(cat => `<div class="detail-line"><span>${cat.label}</span><b>${week[cat.key]}${cat.min ? ' / min ' + cat.min : ''}</b></div>`).join('')}
        <div class="detail-line"><span>Daily Steps</span><b>${stepsDone}/7</b></div>
        <div class="detail-line"><span>Rest Day</span><b>${week.restDay ? 'Yes' : 'No'}</b></div>
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
    CATEGORIES.forEach(c => { months[mKey].totals[c.key] += w[c.key]; });
    STEP_DAYS.forEach(d => {
      months[mKey].totals.stepsTotal += 1;
      if (w[d.key]) months[mKey].totals.stepsMet += 1;
    });
    if (w.restDay) months[mKey].totals.restDays += 1;
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
      ${CATEGORIES.map(c => `<div class="month-stat"><span>${c.label}</span><b>${m.totals[c.key]}</b></div>`).join('')}
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
