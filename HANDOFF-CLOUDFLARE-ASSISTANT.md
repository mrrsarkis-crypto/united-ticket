# Paste this to the Cloudflare dashboard assistant

I'm working with a separate assistant on the **United Traffic Tickets Defense** site
(Cloudflare account `dc59db902477a26c1031d860bb1b0954`, zone `unitedtraffictickets.com`,
zone id `909f4dce383d13bad4f8e1410cbd02de`, Pages project `ticket-fighter`).

The redesigned frontend is already deployed and live on both custom domains. These are the
remaining Cloudflare-side tasks so payments + case tracking work end to end. Please do ONLY what's
listed below and do not change DNS or remove the Access app.

## 1. Bind the CASES KV namespace to the `ticket-fighter` Pages project
- Workers & Pages → `ticket-fighter` → Settings → Bindings → Add → **KV Namespace**
- Variable name: `CASES`
- Namespace: `ticket-fighter-cases` (id `9a4dddc310f2406a86f9e3c3da65565d`)
- IMPORTANT: bind it as a **KV Namespace** (NOT D1). The functions use `env.CASES.get/put`.
- Then trigger a redeploy of the current production build so the binding takes effect.
- Do NOT move bindings into `wrangler.toml` (keep the project in dashboard/non-authoritative
  config mode so the Stripe secrets below can be added via dashboard).

## 2. Confirm custom domain serving
- Confirm both `unitedtraffictickets.com` and `www.unitedtraffictickets.com` serve the
  `ticket-fighter` Pages project (currently correct). Do not change their DNS.

## 3. Leave Stripe environment variables for me to add
- Do NOT create or guess any `STRIPE_*` environment variables or secrets. I will provide the
  key/price IDs/webhook secret manually. Just confirm which heading they should go under
  (Settings → Environment Variables → Secrets vs Variables) when I'm ready.

## 4. Do not touch access/DNS
- Do not modify the "All Workers" Access app, any custom domains, or any DNS records.

## What to report back
1. Whether the `CASES` → `9a4dddc310f2406a86f9e3c3da65565d` binding is now on the PRODUCTION
   deployment, and the current production deployment URL.
2. Confirmation that both custom domains are attached to `ticket-fighter` and serving it.
