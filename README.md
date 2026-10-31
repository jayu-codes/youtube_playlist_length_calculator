# Playlist Clock

A responsive, frontend-only YouTube playlist length calculator. Calculate watch time, compare playback speeds, select part of a playlist, and plan when you will finish. Built with Vite and plain JavaScript, with dark mode by default and a light theme.

## Features

- Up to five playlists or individual videos in one calculation.
- Playlist URLs, playlist IDs, watch URLs, Shorts URLs, and `youtu.be` links.
- Full playlist, specific video range, and remaining-video calculations.
- Preset and custom playback speeds with time savings.
- Total duration and per-video statistics.
- Daily watch planner with selected weekdays and an estimated finish date.
- Video details and real `.xlsx` spreadsheet export, including clickable links.
- Shared site API key with an optional visitor-provided override.
- Responsive layout, keyboard-friendly controls, reduced-motion support, and saved theme preference.
- Static HTML content, metadata, structured data, production canonical URL, sitemap, robots rules, and social sharing image.

## Run locally

Use Node.js 22.12 or later.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_YOUTUBE_API_KEY` in `.env.local` for live results. A missing key does not affect the labeled sample mode. Never add `.env.local` to Git.

```sh
npm test
npm run build
npm run preview
```

The production output is `dist/`. Tests cover mocked API responses and calculation rules, reopen generated Excel workbooks to verify their data and links, and run production/preview SEO builds in temporary directories. A real end-to-end YouTube check requires a configured API key and network access.

## Deploy to Vercel

1. Import this GitHub repository into Vercel.
2. Keep the **Vite** preset, build command `npm run build`, and output directory `dist`.
3. Add these project environment variables:

   | Variable | Value |
   | --- | --- |
   | `VITE_YOUTUBE_API_KEY` | Your restricted YouTube Data API v3 key |
   | `VITE_SITE_URL` | Your final HTTPS production origin, such as `https://your-project.vercel.app` |

4. Deploy. If you do not yet know your final domain, deploy once, set `VITE_SITE_URL`, then redeploy.
5. Open a public playlist, check the displayed duration, switch speeds, test a range, and export the workbook.

Vite environment variables are embedded at **build time**. Changing them requires a redeployment. No server, database, OAuth, or Vercel function is needed.

### Configure the Google API key

1. Create or choose a dedicated project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **YouTube Data API v3**.
3. Create an API key under **APIs & Services → Credentials**.
4. Set application restrictions to **Websites / HTTP referrers**. Add your exact deployed host, for example `https://your-project.vercel.app/*`, and your custom domain if used.
5. Set API restrictions to **YouTube Data API v3** only.
6. For local development, add `http://localhost:5173/*`. Only add preview domains that you need; avoid allowing every `*.vercel.app` website.

This is intentionally a browser-visible key. Referrer and API restrictions reduce misuse but do not make it secret. Requests use the Google project's API quota. Once exhausted, the app shows an error until the quota resets or a visitor supplies their own key. For stricter quota control later, move requests to a server-side function with validation, caching, and rate limiting.

## Using the calculator

Paste up to five links, one per line, and choose **Calculate watch time**. **Try an example** uses explicitly labeled sample data and does not call YouTube.

Open **Fine-tune your calculation** to choose **A range** or **Remaining**, or to enter a personal API-key override. **Playback speed** accepts 0.25× to 16×, with preset shortcuts; these are calculation estimates and your video player may support fewer speeds. Updating the selection or speed recalculates already-loaded results without another API request.

After calculating, use **Your watch plan** to set minutes per watching day and the weekdays you prefer. **Already watched** counts available videos within the current selection; it is separate from the original playlist position used by **Remaining**. Open **Explore the videos** for individual entries, or choose **Export Excel** to download the selected entries and a summary.

## Calculation rules

Playlist entries are paginated and video details are fetched in batches. Each occurrence of a duplicate video counts, since it plays again at that position. Range and remaining settings apply independently to each submitted playlist and use its original video positions; unavailable entries do not shift those positions.

Private/deleted entries, unavailable durations, and current or upcoming live broadcasts are excluded and reported. Public and API-accessible unlisted playlists are supported. Private playlists require authentication and are not supported. Regional playback availability is not guaranteed by this duration calculator. Playlists can change while they are being fetched.

Durations come from YouTube metadata. Playback time is total available seconds divided by playback speed. It excludes advertisements, pauses, breaks, and buffering. The planner uses your browser's local calendar and selected viewing days; it is an estimate, not a reservation or reminder.

## SEO and launch checklist

The visible explanatory content is present in the initial HTML rather than requiring JavaScript rendering. The page includes a descriptive title, meta description, a single primary heading, semantic sections, structured data, and social preview metadata. The social image is a local 1200 × 630 PNG; its SVG source is included for editing.

The postbuild script reads `VITE_SITE_URL`, or Vercel's stable `VERCEL_PROJECT_PRODUCTION_URL` when available. It generates the canonical URL, Open Graph URL/image, Twitter image, `robots.txt`, and `sitemap.xml`. Without a production origin, it deliberately omits canonical URLs and a sitemap instead of publishing a placeholder domain. Vercel preview builds are marked `noindex, nofollow` and disallowed in robots rules.

After deployment:

- Confirm the canonical URL uses the domain you intend to rank.
- Open `/robots.txt` and `/sitemap.xml` on the production domain.
- Verify the site in [Google Search Console](https://search.google.com/search-console/) and submit `/sitemap.xml`.
- Check real mobile performance and indexing after launch.
- Keep useful content accurate and earn relevant links naturally.

Technical SEO improves crawlability; search positions are not guaranteed. A newly deployed site can take time to be discovered and indexed.

## Privacy and data flow

Playlist requests go directly from the visitor's browser to Google's YouTube Data API. No analytics, advertising scripts, user accounts, or application database are included. Theme preference is stored locally in the browser. A visitor API-key override is kept in memory for the current page session and is sent only to Google. Downloaded Excel files are generated locally. Google, GitHub, and Vercel have their own service policies and may process normal request metadata.

Playlist Clock is an independent tool and is not affiliated with YouTube or Google.

## Browser integration check

With `npm run preview` running, install Python Playwright and a Chromium browser, then run `python tests/browser_smoke.py`. Set `BROWSER_EXECUTABLE` if using a system browser, `BASE_URL` for a non-default preview URL, and optionally `SCREENSHOT_DIR` for screenshots. The smoke check uses intercepted YouTube fixtures; it verifies the interface, responsive widths, theme persistence, calculations, error handling, and a real Excel download without API credentials.

## Dependency maintenance

ExcelJS is loaded only when Export Excel is clicked; its roughly 271 KB gzipped browser chunk is separate from the initial application. The tested dependency tree reports moderate advisories GHSA-g3hv-75wg-m249 (minimatch in Node-only archive dependencies) and GHSA-w5hq-g745-h8pq (UUID buffer APIs). The former is absent from the browser bundle; the latter is not called by this export flow. The app does not use Node streaming exports, user-supplied glob patterns, UUID buffer APIs, or conditional formatting. Review upstream updates regularly; do not force incompatible major overrides to suppress audit output.
