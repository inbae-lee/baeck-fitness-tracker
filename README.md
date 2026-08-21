# baeck-fitness-tracker

A weekly workout tracker PWA, built for free: Google Sheet (database) → Vercel serverless
function (backend API) → Vercel static hosting (installable frontend). No subscriptions,
no push notifications. Access is restricted to specific Google accounts via Sign In With
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

Stack:
- **Frontend**: plain HTML/CSS/JS, no build step, using
  [Google Identity Services](https://developers.google.com/identity/gsi/web) (GIS) for
  sign-in.
- **Backend**: a single Vercel serverless function ([api/weeks.js](api/weeks.js)) that
  verifies the ID token locally against Google's public keys (via
  [`google-auth-library`](https://github.com/googleapis/google-auth-library-nodejs) — no
  external call needed per request), checks the verified email against `ALLOWED_EMAILS`,
  then reads/writes the `WeeklyLogs` sheet via a service account (Sheets API).
- Both are deployed together on Vercel, so frontend and backend share an origin — no CORS
  to think about.

## Setup

### 1. Google OAuth client ID (for Sign In With Google)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create (or pick)
   a project.
2. **APIs & Services → OAuth consent screen**. User type **External**. Fill in the
   minimal required app info. Leave **Publishing status** as **Testing** — this is
   important: in Testing mode, only accounts you explicitly add as test users can sign in
   at all, which gives you a second layer of access control for free (no Google
   app-verification review needed for a 2-person tool).
3. Under **Test users**, add both:
   - `inbaelee@gmail.com`
   - `carenkang@gmail.com`
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**. Application
   type **Web application**. Under **Authorized JavaScript origins**, add
   `https://baeck-fitness-tracker.vercel.app` and, if you want to test locally,
   `http://localhost:3000`. No redirect URI is needed.
5. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com`). This is not
   a secret — it's meant to be public, safe to commit. It's already set in
   [`config.js`](config.js); update it there if you swap OAuth clients.

### 2. Google Sheet + service account (for the backend)

1. **Enable the API**: in the same Cloud project, APIs & Services → Library → search
   "Google Sheets API" → Enable.
2. **Create a service account**: IAM & Admin → Service Accounts → Create Service
   Account. No project-level role needed — access is granted by sharing the Sheet
   directly (next step).
3. **Create a key**: open the service account → Keys → Add Key → Create new key → JSON.
   This downloads a JSON file — you need two fields from it: `client_email` and
   `private_key`.
4. **Create and share a Sheet**: make a new Google Sheet, add a tab named exactly
   `WeeklyLogs`, and give it this header row:
   ```
   weekKey  email  startDate  uphillWalk  slowJog  strength  steps_mon  steps_tue  steps_wed  steps_thu  steps_fri  steps_sat  steps_sun  padel  golf  rest_mon  rest_tue  rest_wed  rest_thu  rest_fri  rest_sat  rest_sun  updatedAt
   ```
   Each signed-in account gets its own row per week — `weekKey` alone isn't unique,
   `(weekKey, email)` is. The `email` value is set by the backend from the verified ID
   token, not by the client, so there's no way to write into someone else's rows.
   Then share the Sheet with the service account's `client_email` as **Editor**. Copy
   the Sheet ID from its URL (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).

### 3. Deploy on Vercel

```bash
npx vercel login
npx vercel link      # creates/links the Vercel project (name it baeck-fitness-tracker)
npx vercel env add GOOGLE_CLIENT_ID
npx vercel env add GOOGLE_SHEET_ID
npx vercel env add GOOGLE_SERVICE_ACCOUNT_EMAIL
npx vercel env add GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   # paste the full key, including BEGIN/END lines
npx vercel env add ALLOWED_EMAILS                       # comma-separated, e.g. inbaelee@gmail.com,carenkang@gmail.com
npx vercel deploy --prod
```

(Everything above also works by connecting the GitHub repo in the Vercel dashboard
instead — Import Project, add the same five env vars under Settings → Environment
Variables, deploy. Either way, once the repo is linked, pushing to `main` auto-deploys
to `https://baeck-fitness-tracker.vercel.app/`.)

### 4. Run it locally

```bash
npx vercel dev --listen 3000
```

Open [http://localhost:3000](http://localhost:3000) — `vercel dev` pulls your env vars
automatically once linked.

### 5. Install on phone

Open `https://baeck-fitness-tracker.vercel.app/` in Chrome (Android) or Safari (iOS) →
"Add to Home Screen". It behaves like an installed app: own icon, standalone window,
offline-capable UI shell.

## Notes

- Access control has two independent layers: Google only lets the OAuth consent screen's
  test users complete sign-in at all, and `api/weeks.js` separately checks the verified
  email against `ALLOWED_EMAILS` on every request. To add or remove someone, update both
  the Test users list (Cloud Console) and the `ALLOWED_EMAILS` env var (Vercel).
- Sign-in tokens expire after about an hour; Google Identity Services silently re-issues
  one in the background using the browser's existing Google session, so in practice you
  shouldn't need to click "Sign in" more than once every so often.
- Data lives entirely in the Google Sheet — open it directly anytime to eyeball or back
  up the log.
- The app works offline for viewing/logging (writes queue locally and sync on reconnect
  via `localStorage`), but needs network at least once to pull existing history.
- The service worker never caches `/api/*` responses, so workout data always comes from
  the network when it's reachable — only the static app shell is cached for offline use.
- Tracking is per Google account: each signed-in email only ever sees and edits its own
  rows in `WeeklyLogs`, so two people logging the same week keep separate history. The
  local (offline) cache is also namespaced per email, so signing in as a different
  account on the same device won't show or overwrite the previous account's data.
- If you already had rows in `WeeklyLogs` from before the `email` column existed, they
  won't show up for anyone (no row is anyone's data until it has an owner) — fill in the
  right email by hand for any rows you want to keep, or just delete them if they were
  test data.
