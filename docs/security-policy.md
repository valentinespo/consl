# consl — data security & incident response policy

Operator: Bluesteam LLC (consl.ai). Applies to every kind of data consl holds for its customers:
their own business records and the platform data read on their behalf from Amazon (Selling Partner
API, Amazon Ads API), Shopify, TikTok Shop and Meta. Last reviewed 2026-09-15.

## 1. Where data lives and who can reach it

- One database per environment, hosted by Railway (United States). The application reaches it over
  Railway's private network only; the database is not exposed to the public internet by the app.
- Every business row belongs to exactly one customer company (`orgId`) and every query is scoped
  to the signed-in user's company by the data layer. A company's people never see another company.
- Inside a company, the owner grants members per-area permissions (view / create / edit / delete /
  manage). Platform connections (Amazon, Shopify, TikTok, Meta) can only be made or removed by an
  owner.
- Infrastructure (Railway, GitHub, Cloudflare, Clerk, the Amazon and Meta developer accounts) is
  administered by the founder only, under personal accounts with two-factor authentication.
  Access is removed the day a person leaves.
- Passwords on every internal account that can reach customer or platform data (hosting, source
  control, DNS and file storage, the sign-in provider, the platform developer accounts) are at
  least 12 characters including special characters, unique per account and kept in a password
  manager, protected by multi-factor authentication, and rotated at least every 365 days or at
  once if exposure is suspected.
- Network protection: the application runs on Railway's managed platform behind its edge
  (TLS termination, firewalling, DDoS mitigation and platform-level abuse and intrusion
  detection). Only the web service is reachable from the internet; the database lives on the
  private network (segmentation) and accepts no public connections. The hosting and scheduler
  logs in section 4 are reviewed for intrusion signs. Workstations used to administer the system
  run the operating system's built-in anti-malware protections (macOS XProtect and Gatekeeper)
  with automatic security updates and full-disk encryption switched on.

## 2. Encryption and secrets

- All traffic is HTTPS: browser ↔ consl.ai, consl ↔ every platform API.
- Platform access and refresh tokens are encrypted at rest with a key held only in the hosting
  environment (`INTEGRATION_ENC_KEY`); the database never holds a usable token in clear text.
- Application secrets (API client secrets, encryption key, database credentials) live only in the
  hosting environment's variables. They are never committed to the repository, never pasted into
  chat or tickets, never shared between people, never hard-coded.
- User passwords are handled by Clerk (hashed, breach-checked, minimum-length rules enforced);
  consl never sees them.

## 3. What consl does with platform data, and what it does not do

- Selling Partner API data (orders, inventory levels, financial events, catalogue details) is
  read for one purpose: to run the connected company's own inventory, restock and profit views.
  consl requests no restricted roles and never retrieves buyer personal information (names,
  addresses, e-mail addresses, phone numbers).
- Amazon Ads and Meta data are read for one purpose: to show each customer its own advertising
  cost inside its own profit statement. Only daily spend totals are stored.
- Platform data is never sold, never used for consl's own advertising, never shared with any
  outside party, and never exported to other services. Customers see it on their own screens only.
- When a customer disconnects a platform, its tokens are deleted at once; imported ad spend rows
  are deleted with the connection. When a company is deleted, all of its data is purged after the
  grace period.

## 4. Monitoring and detection

- Hosting logs and metrics (Railway) and the application's own scheduler logs are reviewed for
  failed jobs, unexpected errors and unusual traffic. Platform connections that stop working are
  flagged in the product ("Needs reconnect") and in the logs.
- Dependency and platform security advisories are checked at every release.

## 5. Incident response

A security incident is any confirmed or suspected unauthorised access to, or loss or misuse of,
customer or platform data, credentials or keys.

Roles: the founder is the incident lead and owns every step below, including all notifications
(customers, security@amazon.com, other platforms). As the team grows, a deputy is named here.
Anyone who suspects an incident reports it to the incident lead immediately.

1. **Contain** — revoke or rotate the affected credentials (platform app secrets, tokens, database
   password, encryption key), disable the affected access path, preserve logs.
2. **Assess** — establish what data, which companies and which platforms are involved, and how.
3. **Notify** — affected customers without undue delay and at most within 72 hours of
   confirmation. Any incident involving Amazon information is reported to security@amazon.com
   within 24 hours of detection, as Amazon's Data Protection Policies (Selling Partner API and
   Ads API) require; other platforms are notified as their developer terms require.
4. **Recover** — restore from backups where needed, re-issue connections, verify integrity.
5. **Learn** — a written post-mortem within a week, with the fixes shipped and this policy updated.

## 6. Reviews

This policy is reviewed at least every six months (next review due by 2027-03-15), after any
incident, and whenever a new platform integration is added.
