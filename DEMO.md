# 3–5 minute demo walkthrough

Start with `yarn install --frozen-lockfile` then `yarn dev`. Open the regular browser at
http://localhost:8081 and a private window at the same address. For a phone, use Expo Go on the
same Wi-Fi and the terminal QR code. Use two independent browser storage contexts for two users.
The public demo passwords are in README.md and on the sign-in screen.

| Time | Action and expected result |
| --- | --- |
| 0:00–0:35 | Sign in as Alex in the regular window. Show three projects, the signed-in identity, Settings and unit choice. Reload to demonstrate restored sign-in. |
| 0:35–1:00 | Sign in as Priya in the private window/phone. Only Hendricks Kitchen Remodel appears. Briefly use Sam in another context to show the separate deck, then sign Sam out. |
| 1:00–1:45 | Keep Alex’s Office dashboard visible. As Priya, open Capture, choose the kitchen/group, enter “Demo sink wall”, and tap Measure twice. Readings move pending → synced and appear automatically on Alex’s dashboard exactly once. |
| 1:45–2:15 | Show Alex and Priya online. Open another Priya context/device, then close only one; Priya remains online. Explain that an abandoned connection disappears within about 50 seconds. Sam never appears to Alex/Priya. |
| 2:15–3:05 | Put only Alex’s dashboard offline using browser network tools; keep Priya connected. Capture several readings as Priya. Re-enable Alex’s connection: reconnecting changes to Live, and all missed readings appear once in ID order. Alternatively restart only `yarn dev:api`; both sessions restore without a new login. |
| 3:05–3:45 | Export CSV from Alex’s dashboard and open it in Excel/Sheets. Show project/group/label/author/device/date, numeric mm and inches, and the matching display column. Sum the mm column. On Expo Go, use the share sheet to Save to Files/open another app. |
| 3:45–4:15 | Sign Priya out in Settings. Her session is revoked; her other independent login remains valid. Show Alex’s authorized history and the passing checks in a terminal. |

Record the two windows (or mirror a phone) with your usual screen recorder. No recording has
been generated automatically; the browser control host was unavailable in this environment.

Before recording, manually check narrow phone layout, keyboard behavior, large Measure controls,
actual native SecureStore restoration, iOS/Android file sharing, browser download, and opening
the CSV in Excel/Sheets. Check that failed capture retries work after reconnecting, and explain
that pending/failed readings are not a persistent offline queue. Keep Capture open until synced.

To verify unexpected disconnect expiry, close all Priya contexts without signing out and leave
Alex’s dashboard open for about 50 seconds. To verify independent sessions, sign in twice as
Priya in separate storage contexts; logging out of one should leave the other online. Do not use
Reset during the demo unless you intend to delete captured data and sign everyone out.
