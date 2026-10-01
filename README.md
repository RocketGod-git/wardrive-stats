# Wardrive Go · Live Stats

A graphical, auto-refreshed dashboard of **aggregate, anonymous** usage stats for the Wardrive Go app,
built from the [Google Analytics Data API (GA4)](https://developers.google.com/analytics/devguides/reporting/data/v1).

- A scheduled GitHub Action (`.github/workflows/stats.yml`) pulls GA4 every ~30 min and commits
  `docs/data/stats.json`.
- The static dashboard in `docs/` (served by **GitHub Pages**) renders that JSON with Chart.js.
- The Wardrive Go app's hidden stats page loads this site in a WebView.

**No secrets live in this repo.** The service-account key is injected at runtime from a GitHub Actions secret
and is never printed or committed. Only aggregate dimensions are queried (event counts, active users, app
version, country, device model, OS version) — **no user- or device-level data**.

Live site: `https://rocketgod-git.github.io/wardrive-stats/` (after Pages is enabled + the secret is set).

---

## One-time setup (owner)

Everything below is done once, in the Google Cloud / Analytics consoles and this repo's settings. The code is
already wired to consume it.

### 1. Create a service account + grant it GA4 read access
1. In **Google Cloud Console** → the project that backs this GA4 property → *IAM & Admin → Service Accounts* →
   **Create service account** (e.g. `ga4-stats-reader`). No project roles needed.
2. On that service account → **Keys → Add key → JSON** → download the JSON file.
3. Enable the **Google Analytics Data API** for the project (*APIs & Services → Library → "Google Analytics
   Data API" → Enable*).
4. In **Google Analytics** (not Cloud) → *Admin → Property access management* → **+** → add the service
   account's email (the `client_email` from the JSON) with the **Viewer** role.

### 2. Find the GA4 property id
GA Admin → *Property settings* → the numeric **Property ID** (e.g. `123456789`). It's the number, not the
`G-XXXX` measurement id.

### 3. Add two repo secrets
This repo → *Settings → Secrets and variables → Actions → New repository secret*:
- **`GA4_SA`** — paste the **entire contents** of the service-account JSON file.
- **`GA4_PROPERTY_ID`** — the numeric property id.

### 4. Enable GitHub Pages
*Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: `main` / `/docs`.*

### 5. Kick it off
*Actions → "Fetch GA4 stats" → Run workflow.* It will fetch, commit `stats.json`, and Pages will publish.
(Before the secret exists the run is a harmless no-op and the sample data stays on the page.)

---

## Local preview
```bash
cd docs && python -m http.server 8000   # then open http://localhost:8000
```
The page renders whatever is in `docs/data/stats.json` (the committed sample until the job runs for real).

## Making the stats richer
`scripts/fetch_stats.py` queries only standard GA4 dimensions. To chart **custom event parameters** (e.g.
`notable_spotted.category`, `upload.target`), register them as **custom dimensions** in GA Admin → *Custom
definitions*, then add a report for them in the script (the code already isolates each report so a missing
dimension can't break the file).
