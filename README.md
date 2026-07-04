# Cloudflare Email to Webhook Gateway

A one-click template to intercept incoming emails via Cloudflare Email Routing and forward them to a secure backend webhook matching SendGrid's Inbound Parse payload standard.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/amoisis/cf-email-https)

## How to Deploy Your Own Version

1. Fork this repository (or click **Deploy to Cloudflare** below to create your own copy).
2. Update `wrangler.json` with your own values, or set them after deployment:
   * `GATEWAY_URL` — the HTTPS endpoint of your backend webhook server.
   * `CF_CLIENT_ID` — the Client ID of a Cloudflare Access Service Token (optional, but recommended).

   > **Important:** `GATEWAY_URL` must be set before the worker can forward emails. If you set values in the Cloudflare dashboard after deploying, remember that values in `wrangler.json` will overwrite them on the next GitHub Actions deploy.
3. Set the sensitive service token secret:
   ```bash
   wrangler secret put CF_CLIENT_SECRET
   ```
   When both `CF_CLIENT_ID` and `CF_CLIENT_SECRET` are configured, the worker sends them as:
   * `CF-Access-Client-Id`
   * `CF-Access-Client-Secret`
   Your origin server can then verify these headers via Cloudflare Access and reject requests from anywhere else.
4. Deploy:
   ```bash
   npm install
   npm run deploy
   ```
5. Route emails to the worker (this step is required and cannot be done via `wrangler deploy`):
   * In the Cloudflare dashboard, go to **Compute** -> **Email Service** -> **Email Routing**.
   * Choose your domain and click **Routing Rules**.
   * Enable the **Catch-all rule** (or create a specific custom address).
   * Set the **Action** to **Send to a Worker** and select your worker name.
   * Save the rule.

   Without this routing rule, the worker will deploy but will never receive emails.

## Environment Variables & Secrets

| Name | Type | Purpose |
|------|------|---------|
| `GATEWAY_URL` | plain var | Destination URL for parsed emails |
| `CF_CLIENT_ID` | plain var | Cloudflare Access Service Token Client ID |
| `CF_CLIENT_SECRET` | secret | Cloudflare Access Service Token Client Secret |

Keep `CF_CLIENT_SECRET` as a Wrangler secret — never commit it to the repository.