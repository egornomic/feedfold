# feedfold

feedfold is the feed reader I built for myself. Try demo at https://feedfold.com/demo/.

## See feedfold

| Reader | Filters |
| :---: | :---: |
| [![feedfold magazine view populated with demo feeds](docs/screenshots/reader-desktop.png)](docs/screenshots/reader-desktop.png) | [![A feedfold rule that hides matching articles](docs/screenshots/filters-desktop.png)](docs/screenshots/filters-desktop.png) |
| **YouTube article** | **X / Nitter post** |
| [![A YouTube video open in feedfold](docs/screenshots/article-youtube.png)](docs/screenshots/article-youtube.png) | [![An X post open in feedfold](docs/screenshots/article-nitter.png)](docs/screenshots/article-nitter.png) |

## Features

- Supports websites without RSS, Atom, or JSON feeds by extracting repeated entries from webpages, including pages rendered by JavaScript.
- Filters feeds by removing YouTube Shorts or matching words.
- Extracts full article text.
- Installs as a Progressive Web App with a standalone window, home-screen shortcuts, and an offline application shell.
- Supports OpenAI, Anthropic, and Gemini models for custom workflows such as summaries and article fact-checking.
- OPML import/export.
- YouTube account connection with daily subscription sync for the hosted app.
- Preserves separate sorting settings for each feed or folder in the aggregate view. For example, you can configure X.com posts to always display chronologically from oldest to newest without affecting the sorting method for other feeds.

## Run the macOS desktop app

The Electron app is fully local. It opens no HTTP port, needs no account or hosted backend, and sends application requests through a narrow IPC bridge. SQLite, background refreshes, article extraction, and the bundled headless browser all run inside the app. The hosted version remains available separately.

Install the Apple silicon build with Homebrew:

```sh
brew install --cask egornomic/tap/feedfold
```

For local development:

```sh
npm run dev:desktop
```

To build and open the desktop app:

```sh
npm run build && npm run desktop
```

To create distributable DMG and ZIP artifacts in `release/`:

```sh
npm run desktop:package
```

Desktop data is stored at `~/Library/Application Support/feedfold/feedfold.db`. Provider API keys are encrypted using secure storage in macOS before they enter SQLite. Feed refreshes continue while the app is running; use **feedfold → Quit feedfold** or <kbd>⌘Q</kbd> to stop it completely.

## Start feedfold with Docker Compose

The included Compose deployment runs one Node.js 24.18.0 process, starts sandboxed headless Chromium when a web feed loads, and stores SQLite data in a named volume.

1. Create a project-level `.env` file with `FEEDFOLD_REGISTRATION_MODE=open` and `FEEDFOLD_MAX_ACCOUNTS=1` for a single-account server. Then build and start feedfold:

   ```sh
   docker compose up -d --build
   ```

2. Open `http://localhost:3000/`. Using `localhost` also enables passkeys during local access.

3. Choose **Create the first account**. Setup signs in the new account immediately and then closes public account creation.

4. Check that the container is ready:

   ```sh
   docker compose ps
   ```

5. Check that the server can query SQLite:

   ```sh
   curl --fail http://127.0.0.1:3000/health
   ```

The health endpoint returns HTTP 200 when the SQLite query succeeds. Application data is stored in the `feedfold-data` volume at `/data/feedfold.db`.

## Configure YouTube credentials

For production, set `FEEDFOLD_YOUTUBE_SECRETS_FILE` in `.env` to the absolute path of a restricted JSON file outside the repository and database backups. Compose mounts this file read-only. Its fields are:

```json
{"clientId":"YOUR_CLIENT_ID","clientSecret":"YOUR_CLIENT_SECRET","tokenKey":"YOUR_BASE64_KEY"}
```

For local development with `npm run dev`, leave the file setting empty and set `FEEDFOLD_YOUTUBE_CLIENT_ID`, `FEEDFOLD_YOUTUBE_CLIENT_SECRET`, and `FEEDFOLD_YOUTUBE_TOKEN_KEY` in your gitignored `.env`.

For a new installation, generate the encryption key once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Preserve the existing key when changing configuration: replacing it prevents access to stored Google tokens. Keep a protected copy separately from database backups. A configured secrets file takes precedence over all three local values; missing fields do not fall back to `.env`.

## Configuration reference

Compose reads these values from the shell or a project-level `.env` file:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FEEDFOLD_BIND_ADDRESS` | `127.0.0.1` | Host address that publishes the container port. Keep loopback when a local reverse proxy provides access. |
| `FEEDFOLD_PORT` | `3000` | Host port forwarded to feedfold. |
| `FEEDFOLD_BASE_PATH` | `/` | Browser-facing path where feedfold is mounted. Set this at build time and server runtime, including the leading and trailing slash, when a reverse proxy publishes feedfold below a path such as `/feedfold/`. The Docker image preserves the value used during its build. |
| `FEEDFOLD_PUBLIC_ORIGIN` | none | Exact external HTTPS origin used for secure cookies, passkeys, and browser-origin validation. |
| `FEEDFOLD_REGISTRATION_MODE` | `closed` | Registration policy: `closed`, `invite`, or `open`. A positive account cap is also required; invite registration requires an invitation. |
| `FEEDFOLD_MAX_ACCOUNTS` | `0` | Account cap, including the owner. `0`, a missing value, or an invalid value disables registration under every policy. |
| `FEEDFOLD_MANUAL_REFRESH` | `false` | Allow user-triggered refreshes: `true` or `false`. |
| `FEEDFOLD_ACCOUNT_ACTIVITY_WINDOW_DAYS` | `7` | Stop scheduled refreshes for accounts inactive for this many days. |
| `FEEDFOLD_MAX_FEEDS_PER_ACCOUNT` | `300` | Total subscriptions per account, including web feeds. |
| `FEEDFOLD_MAX_WEB_FEEDS_PER_ACCOUNT` | `10` | Web subscriptions per account. |
| `FEEDFOLD_MAX_PENDING_REFRESHES` | `2000` | Maximum queued feed refreshes across the server. |
| `FEEDFOLD_RECENT_AUTH_SECONDS` | `300` | Time after authentication during which credential changes do not require another check. |
| `FEEDFOLD_REGISTRATION_IP_LIMIT` | `10` | Registration attempts allowed per source during the registration cooldown. |
| `FEEDFOLD_REGISTRATION_GLOBAL_LIMIT` | `100` | Registration attempts allowed across the deployment during the registration cooldown. |
| `FEEDFOLD_REGISTRATION_COOLDOWN_MINUTES` | `60` | Registration cooldown window. |
| `FEEDFOLD_LOGIN_IP_LIMIT` | `50` | Failed sign-in attempts allowed per source during the login cooldown. |
| `FEEDFOLD_LOGIN_ACCOUNT_LIMIT` | `10` | Failed sign-in attempts allowed per account name during the login cooldown. |
| `FEEDFOLD_LOGIN_COOLDOWN_MINUTES` | `15` | Login cooldown window. |
| `FEEDFOLD_STEP_UP_LIMIT` | `10` | Failed recent-authentication attempts allowed per session during its cooldown. |
| `FEEDFOLD_STEP_UP_COOLDOWN_MINUTES` | `15` | Recent-authentication cooldown window. |
| `POLL_INTERVAL_MINUTES` | `20` | Starting interval for new published feeds, rounded up to 5, 10, 20, 30, or 60 minutes. |
| `FEED_FETCH_TIMEOUT_MS` | `15000` | Feed request timeout, in milliseconds. |
| `WEB_FEED_LOAD_TIMEOUT_MS` | `30000` | Maximum normal load time for a JavaScript-rendered web feed, in milliseconds. |
| `ARTICLE_FETCH_TIMEOUT_MS` | `20000` | Full-article request timeout, in milliseconds. |
| `AI_REQUEST_TIMEOUT_MS` | `60000` | AI provider request timeout, in milliseconds. |

All server settings are independent. Limits and resource quotas accept a positive integer or `unlimited` to disable that individual limit. `FEEDFOLD_MAX_ACCOUNTS` instead accepts a nonnegative integer; `0` disables registration. Both the registration account cap and registered-account resource quota apply.

The desktop app remains local, account-free, and unrestricted. Server registration, limit, and quota settings do not affect it.

Resource quotas:

| Variable | Default | Scope |
| --- | ---: | --- |
| `FEEDFOLD_QUOTA_FEED_DISCOVERIES_PER_DAY` | `100` | Per account, per UTC day |
| `FEEDFOLD_QUOTA_WEB_ANALYSES_PER_DAY` | `20` | Per account, per UTC day |
| `FEEDFOLD_QUOTA_CHROMIUM_CONCURRENT` | `2` | Whole server |
| `FEEDFOLD_QUOTA_ARTICLE_EXTRACTIONS_PER_DAY` | `200` | Per account, per UTC day |
| `FEEDFOLD_QUOTA_ARTICLE_EXTRACTIONS_CONCURRENT` | `4` | Whole server |
| `FEEDFOLD_QUOTA_MEDIA_PROXY_REQUESTS_PER_DAY` | `1000` | Per account, per UTC day |
| `FEEDFOLD_QUOTA_OPML_UPLOAD_BYTES` | `1048576` | Per import |
| `FEEDFOLD_QUOTA_OPML_FEEDS_PER_IMPORT` | `300` | Per import |
| `FEEDFOLD_QUOTA_ARTICLES_PER_ACCOUNT` | `50000` | Per account |
| `FEEDFOLD_QUOTA_STORED_BYTES_PER_ACCOUNT` | `536870912` | Per account |
| `FEEDFOLD_QUOTA_OUTBOUND_REQUESTS_CONCURRENT` | `20` | Whole server |
| `FEEDFOLD_QUOTA_OUTBOUND_REQUESTS_PER_DAY` | `50000` | Whole server, per UTC day |
| `FEEDFOLD_QUOTA_REGISTERED_ACCOUNTS` | `1000` | Whole server |
| `FEEDFOLD_QUOTA_GLOBAL_STORED_BYTES` | `21474836480` | Whole server |

The container fixes its internal runtime settings to `HOST=0.0.0.0`, `PORT=3000`, and `DATABASE_PATH=/data/feedfold.db`. For a non-container deployment, `.env.example` lists every server setting.
