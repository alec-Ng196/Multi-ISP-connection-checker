# Multi-ISP Domain Checker

A VS Code extension for comparing domain connectivity, inspecting DNS records, and measuring HTTP requests from your machine.

For step-by-step Vietnamese instructions, examples and interpretation of results, read [QUICKSTART.md](QUICKSTART.md).

## Three diagnostic modes

| Mode | Capabilities |
|---|---|
| **Kết nối đa ISP** | Existing local and Globalping DNS/TCP/TLS/HTTP, ping, traceroute and cross-network comparisons. |
| **DNS records** | Local A, AAAA, CNAME, MX, TXT, NS, SOA, CAA and SRV queries; optional resolver; CNAME chain; record details and TTL where available. |
| **HTTP / WAF** | Local request timeline for DNS, TCP, TLS, upload, headers and full body; stage deadlines and total deadline; repeated samples, timeout rate and p50/p95/p99. Custom method/headers/body and optional direct-origin comparison preserve the original Host/SNI and certificate verification. |

DNS and HTTP diagnostics support cancellation. Results have session history (up to 10 runs), JSON copy/export, and optional JSON/JSONL WAF log matching by request ID. Reports omit request headers/body and redact URL query values. Custom HTTP options apply only to the local HTTP / WAF mode.

HTTP headers timing is receipt of parsed response headers, not exact first-byte timing. HTTP 408/504 responses are counted separately from client deadlines. Client measurements cannot isolate Cloudrity/WAF → backend timing without matching server logs; public-versus-origin differences are not WAF processing time. Requests use fresh connections and do not follow redirects. POST/PUT/PATCH/DELETE send real requests for every sample and selected route.

## What it checks

- Local machine: DNS A/AAAA, TCP connect, TLS/SNI/certificate, HTTP GET, ping, traceroute/tracert.
- Remote networks through Globalping: DNS A/AAAA, TCP connect, TLS/certificate details, HTTP, ping and traceroute. Checks for one network reuse the same probe.
- Cross-network comparison: DNS answer differences, HTTP reachability differences and HTTP status differences.
- Diagnostic hints for DNS failures, TCP/TLS failures, 3xx, 401/403, 404, 429, timeout-related statuses and 5xx responses.

> A Globalping probe selected with `VN+Viettel` (or another network name) is a probe inside a matching network when one is available. It does **not** guarantee that the path is identical to a Viettel 4G/5G handset, FTTH subscriber, or every subscriber in that ISP.

## Run in VS Code

A prebuilt `dist/` folder is included, so the quickest path requires only VS Code: open the folder and press **F5**. A new Extension Development Host opens. Click **Multi-ISP Checker** in the Activity Bar.

You can also run **Multi-ISP: Test Domain** from the Command Palette.

## Modify/rebuild the TypeScript source

If you edit files under `src/`, install the development dependencies and recompile:

```bash
npm install
npm run compile
```

Run the deterministic local test suite with `npm test`. On PowerShell systems that block `npm.ps1`, use `npm.cmd` for these commands. Rebuild `dist/` after source changes, then reload the Extension Development Host.

## Build a VSIX

```bash
npm install
npm run package
```

Install the generated `.vsix` from VS Code: **Extensions → ... → Install from VSIX...**

## Defaults

Country: `VN`

Remote network filters:

```text
Viettel
FPT
VNPT
MobiFone
```

Change them in Settings under **Multi-ISP Domain Checker** or directly in the sidebar for an individual run.

`multiIspChecker.timeoutMs` controls the legacy local connectivity checks. DNS record queries and HTTP / WAF have their own timeout controls in the sidebar; these do not configure Globalping remote timeouts.

## Optional Globalping token

Unauthenticated Globalping calls work subject to public limits. For higher authenticated limits, either set:

```text
GLOBALPING_TOKEN=<your token>
```

in the environment that launches VS Code, or set `multiIspChecker.globalpingToken` in VS Code settings.

Using the environment variable is preferable on shared machines because settings can be copied/synced.

## Interpreting common cases

| Observation | Useful direction |
|---|---|
| DNS fails for one source | Resolver/authoritative DNS/DNSSEC/ISP-specific DNS path |
| DNS OK, local TCP 443 fails | Route, ACL/firewall, BGP/path filtering, service not listening |
| TLS fails | SNI, certificate chain, TLS policy, middlebox |
| HTTP 301/302 | Reachable; compare redirect targets |
| HTTP 401/403 | Reachable; inspect WAF/L7 ACL/bot/Geo-IP/auth policy |
| HTTP 429 | Rate limiting active |
| HTTP 5xx | Reverse proxy/server/upstream problem |
| Ping fails but HTTP works | ICMP may be filtered; not sufficient evidence of an outage |
| Different A records by source | DNS/CDN/GeoDNS/Anycast behavior worth investigating |

## Notes

- Traceroute is disabled by default because it is slower and consumes additional remote tests.
- The extension limits the remote network list to 8 entries per run.
- Commands are started with argument arrays and `shell: false`; the domain is never interpolated into a shell command.
- Remote probe availability changes over time. If Globalping has no matching online probe, that network row will show the API error instead of pretending it tested that ISP.
- Globalping HTTP requests and measurement polling are bounded by client-side timeouts, so network/API stalls are reported in the result instead of leaving the run pending forever.
