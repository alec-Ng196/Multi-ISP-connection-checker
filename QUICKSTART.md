# Quick start (Windows / VS Code)

1. Extract the project folder.
2. Open the **multi-isp-domain-checker** folder in VS Code.
3. Press **F5**.
4. In the new **Extension Development Host** window, click the network icon named **Multi-ISP Checker** in the Activity Bar.
5. Enter your domain, for example `https://example.com/`.
6. Leave **Local** and **Remote probes** enabled.
7. Start with DNS + Ping + HTTP/TLS. Enable Traceroute only when you need the path.
8. Click **Run test**.

No `npm install` is needed for this first run because `dist/` is already included.

To change the default remote networks, open VS Code Settings and search for `Multi-ISP Domain Checker`, or simply edit the network list in the sidebar before each run.
