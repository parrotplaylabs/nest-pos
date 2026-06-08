# Nest POS

> Open-source inventory and point-of-sale for small shops — Node.js, JSON storage, no database.

Track stock, record sales, build buyer estimates, schedule pick-ups, and export data — all in a single app.

No database required. Configure your shop via environment variables or `config/shop.json`.

## Features

- Inventory with SKU, categories, wholesale/SRP, low-stock alerts
- CSV import / restock (upsert by SKU or name)
- Buyer estimates with social-media copy
- Sales log with profit tracking
- Pick-up schedule builder with shareable messages
- CSV and JSON backup export / restore
- Mobile-friendly UI
- Optional HTTP Basic Auth for hosted deployments

## Quick start

```bash
cd nest-pos
npm install
cp .env.example .env          # optional — edit shop settings
cp config/shop.example.json config/shop.json   # optional — richer config
npm start
```

Open [http://localhost:3848](http://localhost:3848).

Or use Make:

```bash
make start
make stop
make restart
make status
```

## Configuration

Settings are loaded in this order (later wins):

1. `config/defaults.json` — built-in defaults
2. `config/shop.json` — your shop file (copy from `config/shop.example.json`)
3. Environment variables

### Environment variables


| Variable                                | Description                                            |
| --------------------------------------- | ------------------------------------------------------ |
| `SHOP_NAME`                             | App title and header                                   |
| `SHOP_TAGLINE`                          | Browser title suffix                                   |
| `COUNTRY`                               | Shop country code (metadata)                           |
| `LOCALE`                                | Date/number locale (e.g. `en-US`, `en-PH`)             |
| `CURRENCY_SYMBOL`                       | Display symbol (e.g. `$`, `₱`, `€`)                    |
| `CURRENCY_LOCALE`                       | Number formatting locale                               |
| `CURRENCY_CODE`                         | ISO currency code                                      |
| `CONTACT_NUMBER`                        | Shown in estimates, inventory shares, pick-up messages |
| `DEFAULT_LOW_STOCK`                     | Default low-stock alert threshold                      |
| `DEFAULT_PAYMENT_METHOD`                | Default sale payment method value                      |
| `PAYMENT_METHODS`                       | JSON array of `{ "value", "label" }`                   |
| `PAYMENT_REF_PLACEHOLDER`               | Sale form reference field placeholder                  |
| `ESTIMATE_PAYMENT_INFO`                 | Text block in estimate messages                        |
| `PICKUP_LOCATIONS`                      | JSON array of `{ "id", "name", "address" }`            |
| `PICKUP_HOURS_PLACEHOLDER`              | Hours input placeholder                                |
| `PICKUP_NOTES_PLACEHOLDER`              | Pick-up notes placeholder                              |
| `SHOP_CONFIG_FILE`                      | Path to JSON config file                               |
| `SHARE_TEMPLATES_FILE`                  | Path to share-message overrides                        |
| `BACKUP_FILE_PREFIX`                    | Downloaded backup filename prefix                      |
| `HTTP_AUTH_USER` / `HTTP_AUTH_PASSWORD` | Optional Basic Auth                                    |
| `DATA_DIR`                              | Data folder path (default: `./data`)                   |
| `PORT`                                  | Server port (default: `3848`)                          |


### Config file

Copy `config/shop.example.json` to `config/shop.json` and edit. Share message templates live in `config/defaults.json` under `shareTemplates` and can be overridden in your shop file.

Template strings support placeholders:

- `{contact}` — contact number
- `{name}` — customer/buyer name (sales greetings, named estimates)

### Pick-up locations

Define locations in config or env. The Pick-Up tab renders them dynamically from `/api/config` and `/api/pickup`. Schedules are stored in `data/pickup.json`.

## Data

All data lives in `data/` as JSON:


| File             | Contents               |
| ---------------- | ---------------------- |
| `items.json`     | Inventory              |
| `sales.json`     | Sales history          |
| `estimates.json` | Last 5 saved estimates |
| `restocks.json`  | CSV import log         |
| `pickup.json`    | Pick-up schedules      |


## Export & backup

- **Dashboard → Export** — CSV downloads for Excel / Google Sheets
- **Dashboard → Data backup** — downloads all JSON (`items`, `sales`, `estimates`, `restocks`, `pickup`) in one file

To back up: download **Data backup**, then copy each section into `data/*.json`, or use **Restore from backup** on another machine / Railway to load the file directly.

## CSV import

Required column: `name`. Optional: `quantity`, `wholesale`, `srp`, `sku`, `category`, `low_stock`.

Items match on **SKU first**, then **name** (case-insensitive). Existing items get quantity added.

## Deployment

Host on [Railway](https://railway.com/?referralCode=iNLSQG) with persistent volumes and HTTP auth. See [DEPLOY.md](DEPLOY.md) for the full setup guide.

## Consulting and Customization

Need custom workflows, features, or integrations?

Contact us at:

**[parrotplaylabs@protonmail.com](mailto:parrotplaylabs@protonmail.com)**

## License

MIT — see [LICENSE](LICENSE).