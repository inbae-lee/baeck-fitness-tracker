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

Weekly workout tracker PWA: Google Sheet (DB) → Vercel serverless function
([api/weeks.js](api/weeks.js)) → static frontend ([index.html](index.html), [app.js](app.js),
[style.css](style.css)). No build step — plain HTML/CSS/JS. Auth via Sign In With Google
(GIS), token verified locally in the API against `ALLOWED_EMAILS`. Full details in
[README.md](README.md).
