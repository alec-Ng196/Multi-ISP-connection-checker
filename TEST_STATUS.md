# Validation status

Revalidated on **2026-10-23** after resuming the interrupted session: `npm.cmd test` rebuilt `dist/` and passed **47/47 tests**, with no failures or skipped tests. The browser validation below was performed on 2026-10-22 and was not repeated; no UI source changes were needed during this final check.

Validated on **2026-10-22**:

- `npm.cmd test`: **47/47 PASS**, with no failures or skipped tests; includes a full TypeScript compile.
- Compiled `dist/*.js` matches every current `src/*.ts` file in a TypeScript transpilation comparison.
- `git diff --check`: no whitespace errors; Windows line-ending conversion notices only.
- DNS fixture tests cover record types, available TTL, CNAME traversal/cycles/depth, resolver errors, no-data/NXDOMAIN, timeout and cancellation.
- HTTP loopback tests cover complete-body timing, slow headers, body inactivity, hard total deadline, truncation, byte limits, cancellation, repeated public/origin measurements, custom requests and percentile denominators. Dual-stack lookup does not duplicate the TCP stage.
- HTTPS loopback tests cover trusted and untrusted certificates, original Host/SNI through an origin IP/custom port, rejection of a mismatching certificate hostname, and TLS handshake timeout. Production certificate verification remains enabled.
- Host/report tests cover validation, overlapping-run prevention, bounded history, cancellation propagation, URL/credential redaction (including relative redirect locations), selected-result export, log parsing/correlation and late log-import handling.
- Existing Globalping regression tests cover transport/polling timeouts, nested errors, same-probe reuse, DNS merge and remote TCP/TLS result handling using mocked API responses.
- Real Chrome UI check: **PASS** using the generated webview with a mocked VS Code host bridge. Desktop and 320 px layouts, mode switching, form validation, request payloads, escaped untrusted content, progress/timelines, stop, history, copy/export/log controls and keyboard focus were exercised. Screenshots are under `plans/261022-diagnostics/screenshots/`.

## Scope of this validation

The browser check exercises the generated interface, not an actual VS Code Extension Development Host. Automated network checks use local fixtures or mocks. No Cloudrity production system, live customer origin, or live Globalping probe was tested on 2026-10-22. These tests do not establish production timeout behavior or internal WAF → backend timings.

## Earlier live checks

The previous validation record dated 2026-10-04 reported live `google.com` results from Viettel, FPT and VNPT, a Viettel traceroute, and a visible MobiFone “No matching IPv4 probes available” error. It also reported successful local TCP/TLS/HTTP/ping checks and a surfaced local DNS `ECONNREFUSED` error. These historical observations were not repeated for the current change.
