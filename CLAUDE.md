# CLAUDE.md

Instructions for Claude when working in this repo.

## Git workflow

- Commit and push directly to `main` by default. Only create a branch / PR if the user
  explicitly asks for one.

## Versioning

- Every commit+push bumps `MINOR` (`v1.0` → `v1.1` → `v1.2` …). `MAJOR` only changes on
  explicit user instruction (and resets `MINOR` to `0`).
- Update the version in all four places when bumping (see [README.md](README.md#versioning)
  for the full list): `package.json`, `index.html` (`<title>` + both `<h1>`s), the README
  heading, and `CACHE_NAME` in `sw.js`.

## Local dev

- `http://localhost:3000` is already whitelisted in the Google OAuth client's Authorized
  JavaScript origins, so Sign In With Google works against `npx vercel dev --listen 3000`
  without any Google Cloud Console changes.
- A local-only auth bypass exists for skipping the Google sign-in screen entirely: set
  `DEV_BYPASS_EMAIL=<an ALLOWED_EMAILS address>` in a **`.env.local`** file (never via
  `vercel env add`, so it can never reach a real deployment's env config) and `vercel dev`
  picks it up automatically. Hard-gated in `lib/auth.js`/`api/dev-bypass.js` on
  `VERCEL_ENV !== 'production'`, which Vercel sets on every deployed function — so this
  cannot activate on a real Production deployment regardless of env var misconfiguration.

## Project overview

Weekly workout tracker PWA: Google Sheet (DB) → Vercel serverless functions
([api/weeks.js](api/weeks.js), [api/categories.js](api/categories.js)) → static frontend
([index.html](index.html), [app.js](app.js), [style.css](style.css)). No build step — plain
HTML/CSS/JS. Auth via Sign In With Google (GIS), token verified locally
([lib/auth.js](lib/auth.js)) against `ALLOWED_EMAILS`. Full setup details in
[README.md](README.md).

## Data model (v1.5+)

Three Sheets tabs, all partitioned by an `email` column rather than split into a sheet
per user — row-based partitioning already scales fine at this app's size and keeps schema
changes to one place; per-user sheets would multiply that cost for no real benefit here.

- **`WeeklyLogs`** — fixed fields only: `weekKey, email, startDate, steps_*, rest_*,
  updatedAt`. `(weekKey, email)` is the unique key.
- **`CategoryDefs`** — per-user, user-definable workout types (Uphill Walk, Padel, a
  user-added "Long Walk", etc.): `email, id, label, unit, min, sortOrder, archived,
  createdAt, updatedAt`. `id` is an integer **scoped per email** (each user numbers their
  own categories 1, 2, 3… independently), assigned server-side (`max(id) + 1`), never
  client-supplied. Deletes are soft (`archived: true`) — past `CategoryEntries` rows
  reference the id, so the def row must survive for that history to keep making sense.
- **`CategoryEntries`** — one row per `(weekKey, email, categoryId)`: `weekKey, email,
  categoryId, mon, tue, wed, thu, fri, sat, sun, updatedAt`.
- **`UserSettings`** — one row per email, for account-level settings not tied to a
  specific category: `email, stepsMin, updatedAt, restMin` (note `restMin` after
  `updatedAt` — appended at the end to keep older rows' column positions stable). The
  Daily Steps weekly goal (default 7) and Full Rest Day weekly goal (default 1), both
  editable 1–7 from Training Settings — see `lib/userSettings.js`.

Every workout type's weekly minimum (`CategoryDefs.min`) is clamped to >= 1 both
client-side (`MIN_PER_WEEK_MIN` in `app.js`) and server-side (`clampMin` in
`lib/categories.js`) — 0 is never a valid value; "no minimum" categories (Padel, Golf)
still require 1x/week. `scripts/fix-category-min-floor.js` is a one-off patch for rows
that predate this rule.

The frontend never sees this split directly: `api/weeks.js` GET merges a user's
`CategoryEntries` into each week object as `c{categoryId}_{day}` fields (e.g. `c6_mon`),
so `app.js`'s `trackedRows()`/`rowTotal()`/toggle logic treats a dynamic category exactly
like the old hardcoded `uphillWalk_mon` — no special-casing needed there. POST does the
reverse split before writing.

`lib/sheets.js` and `lib/categories.js` hold the shared Sheets-API plumbing and
CategoryDefs/CategoryEntries read/write logic — reused by both `api/` endpoints and
`scripts/migrate-v2-categories.js`.

## Schema migrations

`scripts/migrate-v2-categories.js` is a template for future migrations, not just a
one-off: read the old layout with a hardcoded column list, transform in memory, write the
new sheets, dry-run first (`--dry-run`), and design idempotently (safe to re-run without
duplicating rows). Copy its shape for the next big rework rather than writing one from
scratch.
