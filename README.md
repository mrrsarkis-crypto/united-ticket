# United Traffic Tickets Defense

Self-help traffic ticket defense service with AI ticket scanning, Stripe Checkout payments, and case tracking.

- **Frontend**: static site in `public/` (navy + amber UTTD design)
- **Backend**: Cloudflare Pages Functions in `functions/`
  - `POST /api/cases` — create case + Stripe Checkout session
  - `GET /api/cases/:code` — track case status (Cloudflare KV)
  - `POST /api/webhook` — Stripe webhook fulfillment

## Environment variables (set in Cloudflare dashboard, never committed)
- `STRIPE_SECRET_KEY` (secret)
- `STRIPE_WEBHOOK_SECRET` (secret)
- `STRIPE_PRICE_199`, `STRIPE_PRICE_299`, `STRIPE_PRICE_999`
- `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` (optional)
- `SEND_EMAIL_URL`, `SEND_EMAIL_AUTH` (optional)

## Deploy
```
npx wrangler pages deploy public --project-name ticket-fighter --branch main
```
