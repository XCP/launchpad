# Casa Tookan app

The app manifest is served at `/.well-known/wallet-app.json`. The PNGs under `/wallet-app/` provide its icon, banner and splash. Paths are root-relative so they resolve outside `/.well-known/`.

The manifest makes this site discoverable when a user saves it in Casa Tookan. It does not register the site in a curated directory or enable new signing methods. Bitcoin support is optional because browsing needs no wallet. The splash uses Casa Tookan's automatic readiness timeout.

Wallet connection support is an opt-in pilot; see below.

## Deployment check

- Fetch the manifest without cookies and confirm JSON, HTTP 200 and `Access-Control-Allow-Origin: *`.
- Fetch a missing `/.well-known/` path and a missing `/wallet-app/` image: each must return 404 with CORS, not the homepage.
- Fetch all three images: 1024×1024 opaque icon, 1200×630 banner, 200×200 splash.
- Open the site in the native Casa Tookan browser, save it and reopen its app card. Check the title, artwork and splash dismissal.

Headers are configured in both Next (SSR/404) and Cloudflare Static Assets (public files). Production framing and CSP policies are unchanged; the development iframe bridge is not installed.

Format: https://docs.casatookan.com/apps.html

## Wallet connection pilot

Build with `NEXT_PUBLIC_CASATOOKAN_ENABLED=true` to include Casa Tookan in the SDK chooser. It is off by default. The SDK is pinned to `25425b75142f832705d1c3611ab2cba2adc0f942` (XCP/wallet-sdk#13), including revoked-grant recovery and session-listener restart fixes.

Mainnet Legacy and Native SegWit accounts are supported. Ordinary compose flows use the SDK PSBT fallback. Taproot, nested SegWit, selected-input signing, batches and non-ALL signatures are refused by the adapter.

`npm run test:casatookan` exercises the actual site connection UI with a deterministic test bridge, including signed proofs where the site requests them, rejection/retry, unsupported accounts, chooser selection, mobile late injection, disconnect and revoked grants after reload. `CASATOOKAN_TEST_ENABLED=false npm run test:casatookan` checks the disabled pilot (set the environment variable in the syntax for your shell). Tests use an unfunded fixture and never broadcast.

The SDK has separate live web-development-signer evidence in its PR. These site regressions are simulated-provider tests, not installed iOS/Android or funded-trade verification. Those checks remain required before enabling production.

## Local QA — 2026-10-20

Seven enabled browser checks and two disabled-pilot checks passed on `/es/profile`. The desktop and mobile header connects, signs the proof, restores, rejects unsupported accounts and disconnects. Web typecheck, ESLint, numeric checks and all locale checks passed; 26 session/signature tests passed. All lockfiles pass `npm ci --dry-run --ignore-scripts`.

The browser fixture signs deterministic test messages. Public API calls are blocked, so these runs do not prove live backend authentication or transaction composition. No production deployment or broadcast was performed.

The local Next development server returns a self-redirect for the unprefixed English `/profile` route, on both `localhost` and `127.0.0.1`. `/es/profile` works. The wallet pilot does not change the locale proxy; investigate the English-route behavior before rollout and repeat the check on the deployed build.
