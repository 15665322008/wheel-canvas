# Hamster Atelier · 仓鼠画坊

**Every turn of Squeektoshi's wheel paints a dot.**
Live site: https://mstrsqueek.xyz · Source: https://github.com/15665322008/wheel-canvas

Hamster Atelier turns the real wheel runs of Squeektoshi, the hamster behind
[Squeekchain](https://squeekchain.com), into deterministic generative art. Each
magnet passage the wheel sensor records is one unit of proof-of-work. This site
reads those exact passage timestamps from the public Squeekchain API and paints
one dot-grid picture per UTC day. The same data always gives the same painting.

> Independent community project by mstr, not affiliated with Squeekchain.

<!-- SQUEEKCHAIN REPOSITORY LINE — paste the line Squeekchain gives you after submitting, here: -->
<!-- SQUEEKCHAIN_REPO_LINE_PLACEHOLDER -->

## Features

- **Today, growing live.** Today's painting updates while the hamster runs (`/v1/status` every ~10 s; new runs fetched gently).
- **Awake / asleep.** Running, resting, asleep, or offline, with live RPM, speed, distance, and projected block.
- **Gallery.** One painting per day since the wheel went live on 2026-10-26.
- **Day pages.** Stats, turns-per-hour chart, and a table of every run (sessions split by rests longer than 60 s).
- **Run portraits.** A 1200×630 dot-matrix equalizer for each run.
- **Exports.** PNG (2×) and SVG of every painting, plus *Share on X*.
- **How it's drawn.** A full explanation of the algorithm.
- **Prediction Painting / 个人预测画** (`#/predict`). Guess how many turns the current 10-minute Squeekchain round will end with (slider + number box, with a hint from recent rounds). The guess locks on submit and is stored only in this browser, one per round. When the round closes, the site counts the round's real passages, scores your accuracy, and paints a picture from the passage timestamps plus your guess. Rounds within 5% get a bullseye. Each result has PNG download, *Share on X* and a permalink. Your history shows thumbnails, average accuracy, streak and bullseyes. Pending guesses resolve when you come back.
- **Overlay Studio / 直播叠加工作室** (`#/studio`). Pick a layout, size, theme, accent colour, language and the stats to show. You get a live preview, a copyable URL, the exact OBS source size and setup steps.
- **OBS overlay.** `/?overlay=1`:
  - `layout=canvas|full|bar|ticker`
  - `size=160..1080` sets the painting width; `w=240..1920` sets the bar/ticker width
  - `theme=transparent|dark|light`
  - `accent=RRGGBB`
  - `stats=status,rpm,turns,dist,round`
  - `lang=zh|en`
  - Old links keep working: `&stats=0` shows the painting only, and `&size=` and `&lang=` behave as before.
- **中文 / English toggle.** Also settable with `?lang=`.
- **Responsive.** No wallet, no sign-in, no forms, no tracking.

## How it's drawn (short)

| Visual | Data |
| --- | --- |
| Angle | UTC time of day (00:00 at top, clockwise) |
| Distance from centre | Speed: 878 mm ÷ median of the last 5 passage gaps (0.75 → 1.35 m/s) |
| Dot size / brightness | Number of turns in that grid cell |
| Palette | Chosen by the day's fingerprint (FNV-1a of all passage times) |
| Rim sparks | Start of each run |

One passage ≈ one wheel turn ≈ 878 mm (lifetime observed distance ÷ accepted work units).

## Data

- Source: `https://api.squeekchain.com` (`/v1/status`, `/v1/measurement/runs`, `/v1/measurement/stats`, `/v1/measurement/blocks`). This is public, needs no key, and is Sepolia-testnet device evidence for display only.
- `scripts/snapshot.mjs` crawls runs incrementally (one page every 650 ms, under the 2 req/s limit). It writes compact per-day JSON to `public/data/days/YYYY-MM-DD.json` plus `public/data/index.json` and `state.json`.
- `.github/workflows/snapshot.yml` runs it twice a day and commits `public/data`.
- In the browser, the site loads the snapshot and then fetches only newer runs from the live API. If no snapshot exists, it falls back to crawling the API directly.
- Rounds use `roundSchedule` (genesis and duration) from `/v1/measurement/blocks`. The live open-round work is `builder.queued.openRoundWorkUnits` from `/v1/status`. The 7-day round hint uses `rounds` from `/v1/measurement/stats?range=7d` when it is filled in, and otherwise falls back to the local passage data.
- Re-deploys: when the API starts a new installation, the old snapshot cursor is rejected (`400 invalid_cursor`). Both the browser and `snapshot.mjs` then restart from the first page of the new installation and keep the earlier days.

## Develop

```bash
npm install
npm run snapshot       # incremental; `npm run snapshot:full` re-crawls from the start
npm run dev            # http://localhost:5173
npm run build          # -> dist/
npm run preview        # http://localhost:4173
```

## Deploy (Cloudflare Pages)

- Framework preset: *None* (Vite)
- Build command: `npm run build`
- Build output directory: `dist`
- Node version: 20 (env `NODE_VERSION=20`)
- Custom domain: `mstrsqueek.xyz`

Each data commit from the Action triggers a rebuild automatically.

## License

MIT © 2026 mstr. Squeekchain and Squeektoshi belong to their respective owners. The hamster glyph in the paintings is original dot art.
