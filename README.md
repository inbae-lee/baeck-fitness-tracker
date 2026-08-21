# LapLog

A weekly workout tracker PWA, built for free: Google Sheet (database) → Google Apps
Script (backend API) → GitHub Pages (installable frontend). No subscriptions, no push
notifications.

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

### 1. Google Sheet + Apps Script backend

1. Create a new Google Sheet, name it whatever you like (e.g. "LapLog Data").
2. Extensions → Apps Script. Delete the boilerplate `Code.gs` content and paste in
   [`apps-script/Code.gs`](apps-script/Code.gs).
3. Edit the `SECRET` constant at the top to any string you make up.
4. Deploy → New deployment → **Web app**. Execute as **Me**, access **Anyone**.
5. Authorize the permissions prompt, then copy the Web App URL it gives you.

### 2. Wire up the frontend

Edit [`config.js`](config.js):

```js
const APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXX/exec', // your Web App URL
  SECRET: 'CHANGE_ME', // same string as apps-script/Code.gs
};
```

### 3. Host on GitHub Pages

Push this repo to GitHub (public repo, required for free Pages), then:
Settings → Pages → Deploy from branch → `main` / root.

You'll get a `https://<username>.github.io/<repo>/` URL.

### 4. Install on phone

Open that URL in Chrome (Android) or Safari (iOS) → "Add to Home Screen". It behaves
like an installed app: own icon, standalone window, offline-capable UI shell.

## Notes

- The repo must be public for free GitHub Pages, which means `config.js` (API URL +
  secret) is visible to anyone who looks at the source. For a low-stakes personal
  tracker this is an acceptable tradeoff — there's nothing sensitive being written,
  and the URL is obscure. If that ever matters, move the secret check into stricter
  server-side validation or gate the repo behind GitHub Pro (private Pages).
- Data lives entirely in the Google Sheet — open it directly anytime to eyeball or
  back up the log.
- The app works offline for viewing/logging (writes queue locally and sync on
  reconnect via `localStorage`), but needs network at least once to pull existing
  history.
