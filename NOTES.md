# Kerf implementation notes

## How the design fits Dana and Marcus

**Assumptions pending clarification:** Dana is an on-site field worker using capture; Marcus
is an office user monitoring the dashboard. Detailed personas were not provided. These are
design considerations based on assumed roles, not additional requirements quoted from the PDF.

For Dana, the existing simulated tape supports selecting a project/group and label once, then
repeatedly tapping Measure. Buttons/chips have 48-point targets and stronger contrast for mobile
fieldwork. Pending, synced and failed states plus idempotent retries make save outcomes clear.
For Marcus, timely live updates, project-specific access, author/device context, shared-project
presence, CSV export and interruption recovery support office monitoring. Orange cards, a
virtualized newest-first feed, visible identity/sign-out and preserved units keep navigation
familiar and the dashboard scannable.

**Sessions and permissions.** Node crypto supplies salted scrypt password hashes and random
256-bit session tokens; only token hashes persist in SQLite. Sessions survive restarts, expire
after 30 days and revoke individually. SecureStore protects native credentials; localStorage
supports browser restoration. Offline logout asks for reconnection rather than claiming
revocation. Every project, measurement, sync and export query checks membership; unrelated IDs
return 404. Migration preserves data; development/test-only reset revokes all logins. Demo
passwords are public assessment fixtures.

**Live behavior.** Chose authenticated long polling over SSE adapters/WebSockets to minimize
cross-platform transport/parser dependencies. Writes wake waiting requests immediately;
20-second responses renew connections. SQLite IDs/epoch support durable replay, 200-row recovery
pages and reset detection. Snapshot/cursor reads have no async gap; merging by ID removes
replays. Backoff, foreground/online recovery, body-read timeouts and cleanup handle broken links.
Presence uses session-plus-connection leases, 45-second expiry and a 5-second sweep. Shared
membership filters visibility; user deduplication preserves presence when one of several
devices closes. Backgrounded native apps count as away; initial presence changes can take a poll.

**Packages and export.** Added SDK-compatible expo-secure-store, expo-crypto (UUIDs),
expo-file-system and expo-sharing, all available in Expo Go. Browser download uses a Blob;
native uses cached files/share sheets, pruning day-old exports on a later export. CSV escapes
special characters, neutralizes formulas, adds UTF-8 BOM/CRLF and exports exact integer mm,
unrounded numeric inches and matching display
values. No new backend dependency; rejected JWTs because sessions simplify revocation. Expo
Doctor caught duplicate native modules/version drift; Expo’s SDK 58 fixer aligned dependencies.

**Verification.** Automated: 56 tests cover HTTP/SQLite auth, isolation, migration, API restart,
451-row replay, retries, ordering, lease expiry, CSV edges, client restoration/reconnect,
timeouts, cleanup and Blob encoding. Typecheck/lint and Expo Doctor (20/20) passed; API startup
and web/iOS/Android bundle compilation succeeded. Final rerun results accompany the Git handoff.
Manual: the developer confirms launching and testing the app successfully on a physical
smartphone with Expo Go; individual scenarios were not specified. Scenario-specific manual
checks remain unconfirmed, including native CSV sharing, Excel/Google Sheets compatibility,
phone API-restart recovery and multi-device
presence. No screen recording is confirmed; DEMO.md supplies the walkthrough.

**Cuts and next week.** No persistent offline outbox, password reset, account administration,
background capture, historical feed pagination or multi-process notification bus. Failed
readings exist only on Capture; fresh loads show the latest 20, with full history in project
screens/CSV. Next: persistent per-user outbox, device E2E tests, streaming exports, HTTPS and
web HttpOnly cookies. I would change the in-memory capture queue first: leaving the screen can
lose a failed reading.

**AI assistance.** AI helped implement, test and document. The recorded development session
shows React lint rejecting synchronous loading initialization in an effect; initialization moved
to selection/retry handlers. The session also records an initial CSV download without BOM
restoration. Response.text stripping the BOM is reproducible, and the byte-level Blob regression
test verifies its correction. Neither intermediate version was committed; Git alone cannot
reconstruct them. No observed Excel/Sheets failure or developer experience of these mistakes
is claimed.
