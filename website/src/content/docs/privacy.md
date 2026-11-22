---
title: Privacy policy
description: 'How colwerk.app and the Colwerk desktop app handle personal data: no cookies, no tracking, no telemetry.'
pagefind: false
head:
  - tag: meta
    attrs:
      name: robots
      content: noindex, follow
---

Last updated: November 2026

This policy explains which personal data is processed when you visit this website and when you use the Colwerk desktop
app.

## Controller

<address>
Dennis Hendricks<br />
Droste-Hülshoff-Str. 21<br />
49632 Essen Oldb.<br />
Germany<br />
Email: dennis@hendricks.rocks
</address>

## This website

### Hosting

This website is hosted on Cloudflare Pages, a service of Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107,
USA. When you open a page, your browser sends technical data to Cloudflare's servers: your IP address, date and time of
the request, the requested URL, the referring page and your browser's user agent. Cloudflare needs this data to deliver
the website and to protect it against attacks.

The legal basis is Art. 6(1)(f) GDPR. Our legitimate interest is a secure and reliable website. Cloudflare may process
data in the USA. Cloudflare, Inc. is certified under the EU-U.S. Data Privacy Framework, so the transfer is based on the
European Commission's adequacy decision (Art. 45 GDPR). For details see
[Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

### No cookies, no tracking

This website sets no cookies and uses no analytics, tracking or advertising services. It loads no fonts, scripts or
other content from third parties. The video on the start page is served from this website.

If you choose a color theme (dark, light or automatic), your browser stores this choice in its local storage, so the
website can show the theme on your next visit. The choice is not sent to us or anyone else. The search runs entirely in
your browser on an index loaded from this website.

### Links to GitHub

The source code and the downloads of Colwerk are hosted on GitHub, a service of GitHub, Inc., 88 Colin P Kelly Jr St,
San Francisco, CA 94107, USA. No data is sent to GitHub while you browse this website. Only when you follow a link to
GitHub does GitHub process your data, as described in the
[GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## The Colwerk app

Colwerk runs entirely on your computer. It has no telemetry, no analytics and no user account. Connection settings,
query history and passwords are stored locally; passwords are encrypted with AES-256-GCM, and the key is kept in your
operating system's keychain. Queries go directly from your computer to the databases you connect to. None of this data
is sent to us. The same applies to cloud services you configure yourself, such as Databricks Unity Catalog, Microsoft
Fabric OneLake or a Microsoft Entra sign-in: Colwerk connects directly from your computer to that provider, and the
provider's privacy policy applies.

### Updates and release notes

When the desktop app starts, and when you choose “Check for updates” in the menu, Colwerk downloads a small file
describing the latest release (latest.json) from GitHub (github.com). In the browser, or if this check fails, Colwerk
asks the GitHub API (api.github.com) for the latest release instead. If you choose to install an update, the update
package is downloaded from GitHub. After an update, and when you open the release notes from the menu, Colwerk loads the
release notes from the GitHub API; this request identifies only the app version.

These requests transmit your IP address and the usual technical request data to GitHub, Inc. They contain no
information about you, your databases or how you use the app. The legal basis is Art. 6(1)(f) GDPR. Our legitimate
interest is to inform you about new versions, including security fixes, and to install them when you ask for it.
GitHub, Inc. is certified under the EU-U.S. Data Privacy Framework. If you block these requests, for example with a
firewall, Colwerk works as before, just without update hints, updates from within the app and release notes.

### DuckDB library and extensions

Colwerk does not ship the native DuckDB library. The first time it is needed, Colwerk downloads it from the npm registry
(registry.npmjs.org), checks it against a hash fixed when the app was built and stores it on your computer. Lakehouse
connections also download DuckDB extensions from DuckDB's extension repository (extensions.duckdb.org) the first time
they are used. These requests transmit your IP address and the usual technical request data to the operators of these
services. They contain no information about you, your databases or how you use the app. If you block these requests,
DuckDB and lakehouse connections are not available until the files are downloaded.

### AI assistants (MCP)

Colwerk contains no AI and sends nothing to any AI service. If you connect an AI assistant through the built-in MCP
server, that assistant can read the schemas and query results you allow it to. Which data reaches which provider then
depends on the assistant you chose, and its provider's privacy policy applies.

## Your rights

You have the right to access your personal data (Art. 15 GDPR), to have it corrected (Art. 16), erased (Art. 17) or its
processing restricted (Art. 18), and to data portability (Art. 20). You may object at any time to processing based on
Art. 6(1)(f) GDPR (Art. 21). To exercise these rights, contact us at the address above.

You also have the right to lodge a complaint with a data protection supervisory authority (Art. 77 GDPR).
