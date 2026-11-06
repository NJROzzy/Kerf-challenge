# Kerf

Kerf is a measurement logger for construction crews. Someone on site takes measurements with a
Bluetooth tape measure, labels them and files them under a project. Back at the office, someone
else checks the office dashboard to see what's been measured.

This repo contains:

| Path              | What it is                                                         |
| ----------------- | ------------------------------------------------------------------ |
| `src/`            | The Expo (React Native) app: crew screens and the office dashboard |
| `packages/api`    | Node + TypeScript API backed by SQLite                             |
| `packages/shared` | Types and display formatting shared by the app and the API         |

The tape measure is simulated (`src/lib/tape.ts`), so you don't need any hardware.

## Setup

You need **Node 22.13 or newer** (tested with 22.23.4; the API uses built-in `node:sqlite`) and **Yarn 1.22**. You
don't need Docker, Xcode or Android Studio.

```bash
yarn install --frozen-lockfile
yarn dev
```

`yarn dev` starts the API on port 4000 and the Expo dev server on port 8081. The app calls the API
directly on port 4000 of the machine it was loaded from: `localhost` in a desktop browser, your
computer's Wi-Fi address on a phone. To point it somewhere else, set `EXPO_PUBLIC_API_URL` (for
example in a `.env` file) and reload the app.

- **Phone:** install Expo Go, make sure your phone is on the same Wi-Fi network as your computer,
  and scan the QR code in the terminal. Your phone needs to reach both ports, 8081 and 4000.
- **Browser:** press `w` in the terminal, or open http://localhost:8081.
- **Office dashboard:** open http://localhost:8081/dashboard in a browser. It's meant for a desktop
  browser, but it works on the phone too ("Office dashboard" on the home screen).

If your network blocks device-to-device traffic (common on office and guest Wi-Fi),
`yarn dev --tunnel` tunnels the Expo dev server, but not the API. You'd also need to expose port
4000 with a tunnelling tool of your choice and set `EXPO_PUBLIC_API_URL` to its address. A desktop
browser works without any of this.

### Other scripts

| Command          | What it does                       |
| ---------------- | ---------------------------------- |
| `yarn dev:api`   | API only (restarts on change)      |
| `yarn dev:app`   | Expo dev server only               |
| `yarn test`      | API integration and client lifecycle tests |
| `yarn typecheck` | TypeScript for the app and the API |
| `yarn lint`      | ESLint for app, API, shared code and scripts |

To add a dependency to the app, use `npx expo install <package>` so you get a version that matches
the Expo SDK.

### Users and data

Sign in with any of these **public demo credentials** (names are case-insensitive):

| Name | Password | Projects |
| --- | --- | --- |
| Alex | `kerf-alex-demo` | Hendricks Kitchen Remodel, Unit 4B Flooring, Garage Shelving |
| Priya | `kerf-priya-demo` | Hendricks Kitchen Remodel, shared with Alex |
| Sam | `kerf-sam-demo` | Maple St Deck, isolated from Alex and Priya |

Use a private browser window or a second device for a different account. Your name appears on
Projects, the dashboard and Settings. **Settings → Sign out** revokes that login on the server;
other devices stay signed in. Sessions survive app/API restarts and expire after 30 days. Invalid
or expired credentials return you to sign-in. If offline at startup, an unexpired cached identity
is retained while synchronization retries. Signing out requires a connection so revocation can
be confirmed.

Passwords use salted scrypt hashes. Session tokens are random 256-bit values; SQLite stores only
their SHA-256 hashes. Native sessions use Expo SecureStore; web sessions use localStorage
(following [Expo Router's session example](https://docs.expo.dev/router/advanced/authentication/)). This is a local assessment app: use HTTPS,
replace demo credentials and consider HttpOnly web cookies before public deployment.

The database lives at `packages/api/data/kerf.db` and is created/seeded on first run. Existing
databases migrate in place, preserving projects, memberships and measurements; old fixed bearer
tokens stop working. **Settings → Reset demo data & sign everyone out** deletes captured data
and restores the seed. The API allows this only with `NODE_ENV=development` or `test`;
`yarn dev:api` enables development explicitly. `yarn workspace @kerf/api start` defaults to
production and disables reset. Set `DB_PATH` to use a separate SQLite file; set `PORT` to change
the API port.

### Capture, synchronization and presence

1. Open **Capture measurements**, pick a project/group and enter a label.
2. Tap the large **Measure** action; the simulated tape logs the reading automatically.
3. Pending becomes synced after server confirmation. A failed reading has a **Retry** action.
   Retries reuse an idempotency key, preventing duplicate saves after an ambiguous timeout.
   Keep Capture open until readings sync: failed/pending readings are held in memory, **not a
   persistent offline queue**.
4. The dashboard starts with the latest 20 measurements in your projects, then automatically
   receives every subsequent authorized measurement, newest ID first. Project screens still
   offer pull-to-refresh. Reloading the app starts a new recent-20 view; all history remains
   available in project details and CSV.

Authenticated **long polling** (`GET /sync`) waits up to 20 seconds, returns immediately on a
measurement or presence change, then reconnects. This deliberately uses ordinary fetch across
web and Expo Go rather than adding an SSE adapter/parser. SQLite measurement IDs are the durable
cursor; recovery pages contain up to 200 rows and drain before the dashboard reports Live.
The initial snapshot and cursor are read synchronously, reconnects resume from the last applied
cursor, and the client merges by ID to deduplicate replay. An API restart retains the cursor
history and sessions; a database reset changes an epoch so old feed state is replaced.

Live, reconnecting and disconnected states are explicit. Retries back off from 1 to 10 seconds;
resuming a native app or a browser online/pageshow event reconnects immediately. Presence is
tracked per login **and** per app/tab connection, renewed on each poll, deduplicated by user and
filtered to people sharing a project. Explicit close/background/logout removes leases when
possible; abandoned leases expire in 45 seconds, with cleanup every 5 seconds. Failed links hide
potentially stale online names. Backgrounded native apps are considered away.

### Export

From the dashboard, choose **Export all my projects (CSV)**. Desktop browsers download a file;
Expo Go opens the native file-sharing sheet so you can save or open it in another app. Native
export cache files remain available for the receiving app; files older than a day are pruned on
the next export (the OS may also clear its cache). An empty
export still includes headers. API errors appear beside the action.

The CSV contains Project, Group, Label, **Measurement (mm)**, **Measurement (inches)**,
**Display measurement**, Captured by, Device, Captured at (UTC), and Measurement ID. Millimeters
preserve the original stored integer exactly; numeric inches use the unrounded mm/25.4 conversion.
Use those numeric columns for arithmetic; the display column matches the app's chosen units
(including its rounded fractional/decimal display). Text is quoted/escaped, spreadsheet formulas
are neutralized with an apostrophe, and UTF-8 BOM/CRLF support Excel and Sheets. Rows are ordered
by increasing measurement ID. Exports always join membership on the server.

### API quick check

```bash
curl http://localhost:4000/health
curl -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"name":"Priya","password":"kerf-priya-demo"}'
```

Use the returned `token` as `Authorization: Bearer <token>`:

| Request | Behavior |
| --- | --- |
| `GET /me` | Current authenticated user |
| `POST /auth/logout` | Revoke this session and its presence |
| `GET /projects` | Membership-scoped projects |
| `GET /projects/:id/measurements` | Groups and readings; inaccessible IDs return 404 |
| `POST /groups/:id/measurements` | Positive integer mm, label, deviceId; optional clientId for retries |
| `GET /sync?connectionId=<unique-id>` | Snapshot, epoch, cursor, online users |
| `GET /sync?connectionId=<unique-id>&after=<cursor>&epoch=<epoch>` | Long-poll recovery; `wait=0` for an immediate response |
| `DELETE /presence/:connectionId` | Release only this session's connection |
| `GET /export.csv?unit=metric` | All your projects; display unit also accepts decimal/fractional |
| `GET /projects/:id/export.csv` | Single authorized project |

Connection/client IDs must contain 16–100 letters, digits or hyphens (UUIDs work). Every route
except health, login and CORS preflight requires a valid bearer session. Credentials are sent in
headers, never in URLs. No API key or external account is required.

### Verification and demo

```bash
yarn typecheck
yarn lint
yarn test
npx expo-doctor
```

Tests use temporary SQLite files and ephemeral localhost ports. They cover authentication,
restoration/revocation, project/live/presence/export isolation, API restart and paginated replay,
idempotent writes, ordering/deduplication, connection cleanup, lease expiry, and CSV escaping,
formula safety, precision and empty exports. See [NOTES.md](NOTES.md) for verification boundaries
and [DEMO.md](DEMO.md) for a timed 3–5 minute walkthrough and remaining device checks.

## Where the product is headed

Crews are starting to share projects, so a superintendent and several subcontractors will log into
the same job. And a few of our larger customers want their own tools to log measurements straight to
the API rather than going through the app.

## The task (original challenge baseline)

Today there's no sign-in: the app always acts as Alex. The office dashboard only shows new
measurements when you reload it, nobody can tell who else is around, and there's no way to get
measurements into a spreadsheet. We want four things.

### 1. Sign-in

Replace the fixed tokens with real sign-in. Each person signs in as themselves, in the app and on
the dashboard, and stays signed in until they sign out. You decide how the seeded users get
credentials; tell us how to sign in as each of them.

### 2. Live updates

New measurements should appear on the office dashboard as soon as they're captured, without a
reload. Choose the approach and any libraries yourself. Whatever you build has to:

- work in a desktop browser and in Expo Go on a phone on the same Wi-Fi network
- after a dropped connection (a laptop going to sleep, a Wi-Fi blip, an API restart), catch up
  on everything that was missed, with nothing missing and nothing repeated
- only ever show a user measurements from projects they belong to

### 3. Who's online

The dashboard should show who's online right now. Someone counts as online while they have the app
or the dashboard open on any device.

- Only show people who share at least one project with you.
- Someone with the app open on two devices shows up once, and stays online if they close just one.
- Someone whose device just disappears (a laptop lid closed, a phone's battery dying) drops off within
  a minute or so.

### 4. CSV export

The office wants to work with measurements in a spreadsheet. Add an export to the office dashboard
that downloads a CSV of the measurements in your projects: project, group, label, measurement, who
captured it, on which device, and when.

- It has to open cleanly in Excel and Google Sheets.
- Measurements must match what the app shows, and people need to be able to do arithmetic with them
  in the spreadsheet.
- Only include projects you belong to.
- It has to work from the dashboard in a desktop browser and on a phone.

## Instructions

- Your submission is due **within 4 hours** of when the challenge email was sent, including your
  notes and screen recording. If you can't finish, decide what matters most and tell us why.
- Use whatever tools you normally would, AI assistants included. We encourage it, but you need to
  be able to defend every choice the AI made.
- If something is ambiguous, make a reasonable call and write it down. If you're stuck on setup or
  have a question, email us at **josh@reekon.tools**.

## What to send back

1. **Your code**, with setup instructions we can follow in under 10 minutes.
2. **A one-page `NOTES.md`** at the root covering:
   - The design you chose for each feature, the alternatives you rejected, and why
   - How it behaves when things go wrong: dropped connections, an API restart, the same user on
     two devices, someone asking for a project they're not in
   - Which packages you used and why, and anything you considered and rejected
   - Anything in the existing code that got in your way, and what you did about it
   - How you verified it works
   - What you cut, and what you'd build next with another week
   - At least one place where AI tooling was wrong or unhelpful, and how you noticed
3. **A 3–5 minute screen recording** demoing the completed product.

Email a link to your GitHub repository (with your git history) to **josh@reekon.tools**, with the
screen recording attached.
