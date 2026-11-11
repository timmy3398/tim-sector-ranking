# Shioaji read-only quote bridge

Optional read-only quote source for the Cloudflare Worker.

## Security
- Quote endpoint only; no order placement, account, balance, or position routes.
- Credentials and the Worker bearer token are environment variables only. Never commit the real `.env` file or paste secrets into chat.
- Keep port 8000 private and place the service behind HTTPS. Do not expose it directly to the public internet.
- The bridge reads all unique 4-digit stock codes from the public `public/mapping.json`, and refreshes subscriptions periodically.
- If Shioaji does not provide cumulative traded amount, this service returns null rather than fabricating turnover.

## Setup
1. Apply for Shioaji API access with SinoPac and confirm quote/data permissions and any IP allowlist requirements. Enable market-data permission only; this service has no trading route.
2. Provision an always-on Linux VPS with Docker Engine and Compose.
3. Copy this folder to the VPS. Copy `.env.example` to `.env` on the VPS only, and fill in credentials from SinoPac plus a strong random `SHIOAJI_PROXY_TOKEN`.
4. Run `docker compose up -d --build`; check `curl http://127.0.0.1:8000/health` locally.
5. Put the service behind HTTPS and firewall it. Set Cloudflare Worker secrets/variables `SHIOAJI_BASE_URL` (HTTPS base URL) and `SHIOAJI_PROXY_TOKEN` (same random token), then deploy the Worker.

The Worker integration is optional: without both Worker variables, existing TWSE/TPEx/MIS sources continue to operate.

Official documentation: https://sinotrade.github.io/zh/
