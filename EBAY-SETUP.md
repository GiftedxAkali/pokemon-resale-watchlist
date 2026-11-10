# eBay Browse API trial

The Buying Opportunities page reads `ebay-listings.json` (and can also import CSV/JSON manually). The scheduled GitHub Actions workflow `.github/workflows/ebay-buying-opportunities.yml` produces that feed by calling the **official eBay Browse API**.

## Access required

**Real listings require production Browse API access.** eBay lists production Buy API access as limited-release and subject to application/approval. A sandbox key only returns sandbox data and must not be used as if it were live market availability.

1. Register at https://developer.ebay.com/ and request/confirm production Browse API access via eBay's Buy API application process.
2. Generate **Production** App ID (Client ID) and Cert ID (Client Secret). Never enter keys into the public site or commit them to the repository.
3. In GitHub, open **Settings → Secrets and variables → Actions** and create:
   - `EBAY_CLIENT_ID` — production App ID
   - `EBAY_CLIENT_SECRET` — production Cert ID
4. Open **Actions → eBay buying opportunity refresh → Run workflow**. Requires repository Actions permissions to write contents.
5. Inspect the workflow run logs and `ebay-listings.json`. The Buying Opportunities page automatically loads the feed, refreshed twice daily at approximately 14:17 and 20:17 UTC (GitHub schedules may be delayed).

## Trial configuration

The trial scans the top **25** watchlist cards, 15 results per card, two times daily. Adjust `EBAY_SCAN_CARD_LIMIT` to 100 and `EBAY_RESULTS_PER_CARD` in the workflow when ready. One token request plus 25 Browse search requests are made per run (excluding retries). These are *not* sold-price comparisons.

## Conservative matching and limitations

Only fixed-price US listings with a parseable USD price and shipping amount, an exact **card number including denominator**, set name, and card name are imported. Graded, proxy, bulk, multilingual and suspicious listing keywords are excluded. This favors false negatives over wrong-card matches.

Listings are imported as `condition: Unverified`; the dashboard **will not label them buy-ready** without manual confirmation. Watchlist prices are often estimates and may be stale. Inspect the direct eBay listing and current sold comps before buying. Listings may sell or change before a feed refresh.

The public JSON feed contains seller listing links and prices but never credentials. Switching to Soldgraph later requires replacing only the JSON feed generator; the dashboard's schema remains `{listings:[{card,set,number,ask,shipping,source,condition,url,observedAt,notes}]}`.

## Troubleshooting

- HTTP 401: check Production Client ID and Secret.
- HTTP 403: check production Buy API authorization and compliance approval.
- Empty results: title matcher requires exact set and full collector number; expand searches only after verifying results.
- The site shows nothing initially because `ebay-listings.json` is deliberately initialized with zero results until the first successful production API run.
