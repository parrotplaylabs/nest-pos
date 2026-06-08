# Deploying Nest POS

This guide covers hosting on [Railway](https://railway.com/?referralCode=iNLSQG) with persistent storage.

## Prerequisites

- GitHub repo with this project
- Railway account

## Steps

1. **New project → Deploy from GitHub** — select your `nest-pos` repo.

2. **Set environment variables** (Settings → Variables):

   ```
   SHOP_NAME=My Shop
   CONTACT_NUMBER=(555) 123-4567
   CURRENCY_SYMBOL=$
   LOCALE=en-US
   HTTP_AUTH_USER=shop
   HTTP_AUTH_PASSWORD=<strong-password>
   ```

   Configure payment methods, pick-up locations, etc. via env or mount `config/shop.json`.

3. **Add a volume** — mount at `/app/data`.

4. **Redeploy.** The app refuses to start on Railway without a volume (prevents data loss).

5. **Verify** — open `/api/health` after login. It should show `dataDir: /app/data`.

## Data persistence

- Git push does **not** sync live inventory to Railway.
- Use **Dashboard → Download data backup** periodically for off-site backup.
- Download from one environment and use **Restore from backup** on another when moving data.

## Security

- Always set `HTTP_AUTH_USER` and `HTTP_AUTH_PASSWORD` on public hosts.
- Railway requires auth in this app when `RAILWAY_ENVIRONMENT` is set.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Data wiped on redeploy | Volume not mounted at `/app/data` |
| Permission errors | Set `RAILWAY_RUN_UID=0` |
| Wrong currency/locale | Check `CURRENCY_*` and `LOCALE` env vars |
