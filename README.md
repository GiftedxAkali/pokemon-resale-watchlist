# Pokémon Resale Watchlist Website

A mobile-first static website for the Pokémon card resale watchlist.

## Architecture
- `index.html` — page shell
- `styles.css` — responsive styling
- `app.js` — search, filtering, sorting, live refresh, and image fallback logic
- `config.js` — data source configuration
- `data.json` — canonical live dataset updated by the scheduled Friday refresh
- `service-worker.js` — caches the site shell for fast repeat use
- `manifest.webmanifest` — installable phone web app metadata

## Update model
The website itself stays unchanged. The scheduled refresh updates only `data.json`, so the site URL remains permanent while prices, ranks, targets, and verified image URLs change automatically.

## Image handling
The site renders direct card-front URLs in the browser rather than relying on Google Sheets `IMAGE()`. Missing or unverified image URLs display a neutral placeholder instead of a broken or incorrect image.

## Hosting
Recommended hosting is GitHub Pages from the `main` branch root.
