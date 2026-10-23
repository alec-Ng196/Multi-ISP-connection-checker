# Diagnostics implementation — 2026-10-22

Completed local DNS record lookup and HTTP/WAF request diagnostics in the existing VS Code extension.
Preserved the multi-ISP connectivity workflow and introduced three clearly separated UI modes.
DNS supports nine record types, configurable resolver, TTL when available and bounded CNAME following.
HTTP records stages on each actual request, including incomplete stages on timeout or failure.
Added stage deadlines, bounded repeated samples, completed-sample percentiles and cancellation.
Direct-origin comparison preserves Host/SNI and is explicitly client → origin.
The user operates Cloudrity; no access to the internal WAF → backend path was assumed.
Headers-arrival timing is not presented as an exact first-byte timestamp or internal WAF processing time.
Optional log import matches request IDs and displays reported timings without inventing WAF overhead.
Session history and JSON exports omit request credentials/body; the UI escapes untrusted result text.
Updated Vietnamese QUICKSTART and supporting documentation to explain controls and limits.
Validation: 47/47 automated tests passed; real Chrome checks passed at desktop and 320px widths.
Chrome used a local mock webview host, not the actual VS Code Extension Host or live production WAF.
