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
