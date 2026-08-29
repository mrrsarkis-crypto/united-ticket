# United Traffic Tickets Defense — Deployment + Setup Runbook

Status: site LIVE at https://unitedtraffictickets.com (www + .pages.dev). Backend Functions run.
Frontend: fully redesigned to UTTD brand (navy/amber), deployed. All API routes verified working.
Remaining: wire up Stripe (secret key + 3 price IDs + webhook secret). Payment is the ONLY blocker.

## What's already done (verified this session)
- Cloudflare Pages project `ticket-fighter` (account `dc59db902477a26c1031d860bb1b0954`)
- Custom domains `unitedtraffictickets.com` + `www.unitedtraffictickets.com` attached, active, serving UTTD site
- **Redesigned frontend** deployed: United Traffic Tickets Defense, navy+amber, real logos (logo-horizontal.png, hero-driver.webp, logo-defense.png), hybrid self-help copy, all app.js feature IDs retained
- Functions deployed: `/api/cases` (POST create case + Stripe Checkout), `/api/cases/:code` (GET tracking), `/api/webhook` (Stripe webhook)
- KV namespace `ticket-fighter-cases` (id `9a4dddc310f2406a86f9e3c3da65565d`) — **BOUND to CASES on PRODUCTION + PREVIEW** (confirmed via API)
- Storage layer uses binding `CASES` as a **KV Namespace** (records under key `case:<trackingCode>`)
- **compatibility_date set to 2025-07-18** on both production + preview (was 2026-08-29/today, which the runtime didn't support)
- Verified via curl: POST /api/cases -> `500 {"error":"Payment for this service is not configured yet..."}` (expected -> only Stripe left); GET /api/cases/ZZZ -> `404 {"error":"Case not found"}`

## Debugging lesson (IMPORTANT)
- PowerShell `Invoke-WebRequest` FAILS to read response BODIES from error-status responses (500/400/404),
  showing them as empty. This is NOT a real bug. Use `curl.exe` to verify API responses (e.g.
  `curl -s -i -X POST .../api/cases -H "Content-Type: application/json" --data-binary "@body.json"`).
- The earlier "empty 500" panic was this artifact. The functions always worked. Verified.

## Stripe — the only remaining step (on hold: user needs Stripe support for phone verification)
Need from user's Stripe dashboard (acct_1U9r93IrkSSJgWRr):
- Secret key `sk_live_...` or restricted `rk_...`  (pk_ publishable key is NOT sufficient)
- 3 Price IDs `price_...` for $199/$299/$999
- Webhook signing secret `whsec_...`
Then set as env vars/secrets (see below) and redeploy.

## Step A — Create Stripe products/prices (Stripe dashboard)
Create 3 one-time products with prices (USD):
- $199  -> new ticket filing        -> price id `STRIPE_PRICE_199`
- $299  -> failure-to-appear        -> price id `STRIPE_PRICE_299`
- $999  -> suspended-license        -> price id `STRIPE_PRICE_999`
Copy each Stripe Price ID (e.g. `price_1Abc...`).

## Step B — Add environment variables/secrets (Dashboard)
Workers & Pages → ticket-fighter → Settings → Environment Variables
Secrets:
- `STRIPE_SECRET_KEY` = sk_live_... (secret)
- `STRIPE_WEBHOOK_SECRET` = whsec_... (secret)
Variables:
- `STRIPE_PRICE_199` = price_...
- `STRIPE_PRICE_299` = price_...
- `STRIPE_PRICE_999` = price_...
- `STRIPE_SUCCESS_URL` = https://unitedtraffictickets.com/#/success?case=TFX
- `STRIPE_CANCEL_URL`  = https://unitedtraffictickets.com/#/cancel
Redeploy to apply.

## Step C — Stripe webhook
Stripe Dashboard → Developers → Webhooks → Add endpoint:
- URL: https://unitedtraffictickets.com/api/webhook
- Event: `checkout.session.completed` + `checkout.session.async_payment_succeeded`
- Copy the signing secret -> `STRIPE_WEBHOOK_SECRET`

## Step D — Optional email
`SEND_EMAIL_URL` (POST JSON {to,subject,text}) + `SEND_EMAIL_AUTH` (Bearer token)
Used by webhook to email the user their tracking code.

## Security — TOKENS / KEYS
- Cloudflare API tokens and Stripe keys MUST be kept out of this repo. They are set only as
  Cloudflare Pages environment variables/secrets, never committed.
- The original Cloudflare API token leaked in a past chat was rotated/rolled (old token now 401).
- A newer restricted Cloudflare token (`cfut_`) lacks Zone/Cache-Purge permission (401).
  Purge cache manually via dashboard: Caching -> Purge Everything.
- Stripe secret and webhook secrets were shared during setup; ROTATE them once the payment flow is
  verified live (they may have been captured in chat).
- Always use a Cloudflare API token scoped to Pages Edit + Workers Scripts Edit for deploys.
