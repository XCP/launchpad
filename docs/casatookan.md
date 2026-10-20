# Casa Tookan app

The app manifest is served at `/.well-known/wallet-app.json`. The PNGs under `/wallet-app/` provide its icon, banner and splash. Paths are root-relative so they resolve outside `/.well-known/`.

The manifest makes this site discoverable when a user saves it in Casa Tookan. It does not register the site in a curated directory or enable new signing methods. Bitcoin support is optional because browsing needs no wallet. The splash uses Casa Tookan's automatic readiness timeout.

This change adds browsing metadata only. Existing connection and signing flows are unchanged.

## Deployment check

- Fetch the manifest without cookies and confirm JSON, HTTP 200 and `Access-Control-Allow-Origin: *`.
- Fetch a missing `/.well-known/` path and a missing `/wallet-app/` image: each must return 404 with CORS, not the homepage.
- Fetch all three images: 1024×1024 opaque icon, 1200×630 banner, 200×200 splash.
- Open the site in the native Casa Tookan browser, save it and reopen its app card. Check the title, artwork and splash dismissal.

Headers are configured in both Next (SSR/404) and Cloudflare Static Assets (public files). Production framing and CSP policies are unchanged; the development iframe bridge is not installed.

Format: https://docs.casatookan.com/apps.html
