# LapLog

A weekly workout tracker PWA, built for free: Google Sheet (database) → Google Apps
Script (backend API) → GitHub Pages (installable frontend). No subscriptions, no push
notifications. Access is restricted to specific Google accounts via Sign In With
Google — no shared secret anywhere.

Tracks:
- Uphill Walk (30min, min 1×/week)
- Slow Jogging (3KM, min 1×/week)
- Strength Training (45min, min 2×/week)
- Daily Steps 8,000+ (per-day toggle)
- Padel (1H+, no minimum)
- Golf Practice (30min+, no minimum)
- Full Rest Day (1×/week)

Weekly logs auto-archive into a browsable History tab, and roll up into a Monthly tab
for quarterly review.

## Setup

### 1. Google OAuth client ID (for Sign In With Google)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create (or
   pick) a project.
2. **APIs & Services → OAuth consent screen**. User type **External**. Fill in the
   minimal required app info. Leave **Publishing status** as **Testing** — this is
   important: in Testing mode, only accounts you explicitly add as test users can
   sign in at all, which gives you a second layer of access control for free (no
   Google app-verification review needed for a 2-person tool).
3. Under **Test users**, add both:
   - `inbaelee@gmail.com`
   - `carenkang@gmail.com`
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   Application type **Web application**. Under **Authorized JavaScript origins**, add
   the GitHub Pages origin you'll deploy to (e.g. `https://<username>.github.io`) and,
   if you want to test locally, `http://localhost:8850` (or whatever port you serve
   on). No redirect URI is needed.
5. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com`). This is
   not a secret — it's meant to be public, safe to commit.

### 2. Google Sheet + Apps Script backend

1. Create a new Google Sheet, name it whatever you like (e.g. "LapLog Data").
2. Extensions → Apps Script. Delete the boilerplate `Code.gs` content and paste in
   [`apps-script/Code.gs`](apps-script/Code.gs).
3. Set `GOOGLE_CLIENT_ID` at the top to the Client ID from step 1, and confirm
   `ALLOWED_EMAILS` lists exactly who should have access.
4. Deploy → New deployment → **Web app**. Execute as **Me**, access **Anyone**.
5. Authorize the permissions prompt, then copy the Web App URL it gives you.

### 3. Wire up the frontend

Edit [`config.js`](config.js):

```js
const APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXX/exec', // your Web App URL
  CLIENT_ID: 'XXXX.apps.googleusercontent.com', // same Client ID as apps-script/Code.gs
};
```

### 4. Host on GitHub Pages

Push this repo to GitHub, then: Settings → Pages → Deploy from branch → `main` / root.
You'll get a `https://<username>.github.io/<repo>/` URL. Make sure that exact origin
is in the OAuth client's Authorized JavaScript origins (step 1).

The repo can be public or private — GitHub Pages on a private repo needs GitHub Pro,
but since there's no secret in the source anymore (access is enforced by Google
Sign-In + the email allowlist, not by hiding a string), keeping the repo public is a
reasonable free default even though `config.js` is visible to anyone.

### 5. Install on phone

Open that URL in Chrome (Android) or Safari (iOS) → "Add to Home Screen". It behaves
like an installed app: own icon, standalone window, offline-capable UI shell.

## Notes

- Access control has two independent layers: Google only lets the OAuth consent
  screen's test users complete sign-in at all, and `Code.gs` separately checks the
  verified email against `ALLOWED_EMAILS` on every request. To add or remove someone,
  update both the Test users list (Cloud Console) and `ALLOWED_EMAILS` (Code.gs).
- Sign-in tokens expire after about an hour; Google Identity Services silently
  re-issues one in the background using the browser's existing Google session, so in
  practice you shouldn't need to click "Sign in" more than once every so often.
- Data lives entirely in the Google Sheet — open it directly anytime to eyeball or
  back up the log.
- The app works offline for viewing/logging (writes queue locally and sync on
  reconnect via `localStorage`), but needs network at least once to pull existing
  history.
