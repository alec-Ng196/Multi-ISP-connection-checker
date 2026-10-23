# DNS and HTTP/WAF diagnostics

Status: complete.

## Scope and reviewed design

Extend the existing VS Code extension, preserving its multi-ISP connectivity checks. Add a local DNS record explorer and a local HTTP/WAF workbench with a measured single-request timeline, stage deadlines, bounded repeated sampling, direct-origin comparison preserving Host/SNI, request IDs, generic JSON log correlation, session history and explicit JSON export. Remote connectivity remains a separately labelled Globalping GET workflow; never silently send custom credentials or pretend local controls apply to remote probes.

Review: independent connection probes cannot form an HTTP timeline. Measure events on the actual HTTP socket, consume the entire body, label headers timing honestly, retain partial stages on failure, separate deadline expiry from server timeout statuses, exclude incomplete samples from percentiles, and never infer WAF processing time by subtracting unrelated requests. DNS queries are per type; missing records differ from resolver failure and unknown TTL is not invented. Request bodies/credentials are not retained in history or exported. Cancellation must destroy sockets/queries and stop subsequent samples.

## Implementation

- [x] Shared contracts, validated host orchestration, bounded history/export, log import/correlation.
- [x] DNS A/AAAA/CNAME/MX/TXT/NS/SOA/CAA/SRV, resolver selection, bounded alias chain.
- [x] HTTP stage measurements, timeout/partial-body errors, repeat statistics, origin override.
- [x] Accessible, narrow-sidebar-friendly mode selector, contextual controls, timeline and tables.
- [x] Deterministic loopback/DNS fixture tests, existing regressions, UI script/interaction checks.
- [x] Independent code review, rebuilt dist, Vietnamese QUICKSTART and README updates.

## Validation

Exercise delayed headers/body, total deadline despite body activity, truncated response, cancellation, custom methods/headers/body, Host preservation, certificate validation, percentile denominators, DNS NODATA/NXDOMAIN/timeout and injection-safe rendering. Do not rely on public probe availability for automated tests.

Completed: 47/47 automated tests passed. The optional real Chrome check passed against a local mock webview host at desktop and 320px widths, including mode controls, request payloads, escaping, partial timelines, cancellation, history/export and keyboard focus. Screenshots are under `screenshots/`. This does not constitute manual validation in the actual VS Code Extension Host or against live production WAF/backend systems.

## External integration boundary

The user operates their own Cloudrity WAF and cannot readily measure the WAF-to-customer-backend path. The implementation measures from the extension host to the public URL, with optional client-to-origin comparison; it does not claim access to internal WAF/backend timings. Generic JSON/JSONL log import correlates request IDs and explicitly named millisecond timing fields when available. Vendor-specific live ingestion and distributed tracing remain outside this implementation and require deployment access or instrumentation.
