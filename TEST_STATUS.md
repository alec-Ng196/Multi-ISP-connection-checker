# Validation status

Validated on 2026-10-04:

- TypeScript compile: PASS
- Automated regression tests: 6/6 PASS
- Generated webview inline-script syntax: PASS
- Globalping transport timeout, polling timeout and nested 422 error handling: PASS
- Same-probe reuse, DNS A/AAAA merge, remote TCP/TLS extraction and URL query mapping: PASS
- Live `google.com` smoke test: Viettel, FPT and VNPT returned DNS A/AAAA, TCP, TLS, HTTP and ping results with probe/network/ASN metadata. A final Viettel run also returned a 7-hop traceroute.
- Live MobiFone selection returned `422: No matching IPv4 probes available` and was preserved as a visible per-check error.
- Local TCP, TLS, HTTP and ping checks against `google.com`: PASS. Local DNS returned `ECONNREFUSED` in this execution environment and was surfaced as a failed check.

The Globalping integration follows the current `/v1/measurements` create + poll flow, waits at least 500 ms between polls, reuses the first measurement ID to keep checks on one probe, and has bounded request/measurement timeouts.
