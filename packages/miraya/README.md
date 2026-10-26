# Miraya

Finds the bugs that only exist in the right-to-left version of your web app, and checks the SEO and load speed of both languages, in Chromium, WebKit and Firefox.

Miraya opens each page twice in a real browser, once in English (LTR) and once in Arabic (RTL), pairs up the elements between the two, and reports what broke when the page flipped: a sidebar that stayed on the left, a back arrow pointing the wrong way, Arabic drawn in a fallback font, text cut off, English left untranslated.

<img src="https://raw.githubusercontent.com/omaritooo/miraya/main/.github/assets/report-light.png" alt="The Miraya report: English and Arabic screenshots side by side with numbered outlines on each problem, and the list of findings with how to fix each one." width="100%">

- **Measures, doesn't guess.** Every finding comes from positions, fonts and pixels in the rendered page, with the numbers attached.
- **Runs where your tests run.** A CLI for CI and a [Playwright helper](https://www.npmjs.com/package/@miraya/playwright) for your existing tests.
- **Baselines.** Accept today's findings and fail only on new ones.
- **One HTML file.** The report opens from disk, works offline, and is easy to attach to a pull request.

## Install

```sh
npm install --save-dev @miraya/cli @playwright/test
```

Node 20 or later. The package is `@miraya/cli`; the command it installs is `miraya`. Miraya drives Chromium through your project's Playwright, any version from 1.50; the first run downloads Chromium if it isn't there yet.

## Quick start

In your project, run:

```sh
npx miraya
```

The first time, it reads your framework (Next.js, Nuxt, SvelteKit, Astro or Vite), your i18n setup and your page files, shows what it found, and asks to write `miraya.config.ts`. Then, and on every run after that, it starts your app with its dev script, audits each route, stops the app, and opens the report.

You get a summary in the terminal, `.miraya/report.json`, and `.miraya/report.html`, with each finding outlined on both screenshots.

To write the config without auditing, run `npx miraya init` (`--print` shows it without writing). Pages with parameters, like `/products/[id]`, are left commented out for you to fill in with a real page. If your routes don't come from files, `npx miraya init --crawl` finds them by following links.

Or write the config yourself:

```ts
import { defineConfig } from '@miraya/cli'

export default defineConfig({
  baseUrl: 'http://localhost:3000',
  // Started for the run when nothing answers at baseUrl. Leave it out to start the app yourself.
  server: { command: 'npm run dev' },
  routes: ['/', '/pricing', '/account/settings'],
  // How your app switches to Arabic. Here: /en/... and /ar/...
  locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
})
```

## How your app switches direction

Set `locale` to match your app:

| Strategy         | Example                                                                  | Use when                                                                                    |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `path-prefix`    | `{ strategy: 'path-prefix', ltr: '/en', rtl: '/ar' }`                    | The locale is in the path: `/ar/pricing`                                                    |
| `query`          | `{ strategy: 'query', param: 'lang', ltr: 'en', rtl: 'ar' }`             | The locale is a query parameter: `/pricing?lang=ar`                                         |
| `cookie`         | `{ strategy: 'cookie', name: 'locale', ltr: 'en', rtl: 'ar' }`           | A cookie picks the locale (Nuxt i18n, many Rails apps)                                      |
| `local-storage`  | `{ strategy: 'local-storage', key: 'i18nextLng', ltr: 'en', rtl: 'ar' }` | The app reads its language from localStorage (i18next's language detector, many React apps) |
| `context-locale` | `{ strategy: 'context-locale', ltr: 'en-US', rtl: 'ar-EG' }`             | The app reads the browser's language                                                        |
| `attribute`      | `{ strategy: 'attribute' }`                                              | Default. Sets `dir="rtl"` on `<html>`; no translation                                       |
| A function       | `(dir, { page, route }) => \`/${dir === 'rtl' ? 'ar' : 'en'}${route}\``  | Anything else: return a URL, or drive `page` yourself                                       |

`attribute` only flips the layout of the English page, so the text stays English: `untranslated-text` and the `lang` check are skipped, and the font rules have no Arabic to look at. Use it to check the layout of an app that has no translations yet.

## Configuration

Everything except `baseUrl` is optional.

| Option                    | Default                     | What it does                                                                                                                                                                                                        |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                 |                             | Where your app is running.                                                                                                                                                                                          |
| `server`                  |                             | `{ command, timeoutMs }`: how to start the app. Runs `command` when nothing answers at `baseUrl`, waits up to `timeoutMs` (120000) for it, and stops it at the end. An app that's already running is used as it is. |
| `routes`                  |                             | Paths to audit, each starting with `/`.                                                                                                                                                                             |
| `crawl`                   |                             | `{ start, maxDepth, maxRoutes, include, exclude }`: find routes by following links. Use with `--crawl`.                                                                                                             |
| `locale`                  | `{ strategy: 'attribute' }` | How to switch direction. See above.                                                                                                                                                                                 |
| `auth.storageState`       |                             | A saved session, for pages behind a login. `npx miraya login` makes one; see [Pages behind a login](#pages-behind-a-login).                                                                                         |
| `auth.loginUrlPattern`    |                             | If a route redirects here, it's reported as failed instead of auditing the login page.                                                                                                                              |
| `viewport`                | `{ w: 1280, h: 800 }`       | Browser size.                                                                                                                                                                                                       |
| `maxPageHeight`           | `15000`                     | Screenshots stop here.                                                                                                                                                                                              |
| `scrollToLoad`            | `false`                     | Scroll the page first, for content that loads on scroll.                                                                                                                                                            |
| `pairing.testIdAttribute` | `'data-testid'`             | Elements with the same test id are paired first. Add test ids to anything Miraya pairs wrongly.                                                                                                                     |
| `fonts.arabic`            | `[]`                        | Font families you ship for Arabic. Anything else drawing Arabic is a fallback.                                                                                                                                      |
| `allow.latinText`         | `[]`                        | Brand and product names that stay in English.                                                                                                                                                                       |
| `locales`                 |                             | `{ ltr: './locales/en.json', rtl: './locales/ar.json' }`: your translation files, so untranslated text names its key and the file to edit. See [Translation files](#translation-files).                             |
| `source.attribute`        |                             | An attribute holding the source location (`src/Nav.vue:12`), shown with each finding.                                                                                                                               |
| `browsers`                | `['chromium']`              | Engines to audit every page in: `chromium`, `webkit`, `firefox`. See [Cross-browser](#cross-browser).                                                                                                               |
| `checks`                  | `['localization', 'seo']`   | The areas to check: `localization`, `seo` and `performance`. `--checks localization` runs one area for a single audit.                                                                                              |
| `performance`             |                             | How pages load for the performance check, and its budgets. See [Performance](#performance).                                                                                                                         |
| `rules`                   | `{}`                        | `{ 'mixed-digits': 'off', 'not-mirrored': ['warn', { tolerancePx: 8 }] }`                                                                                                                                           |
| `experimental`            | `[]`                        | Experimental rules to switch on, such as `'bidi-isolation'`.                                                                                                                                                        |
| `baseline`                | `'.miraya-baseline.json'`   | Where accepted findings are stored. `false` turns baselines off.                                                                                                                                                    |

The config can be `miraya.config.ts`, `.mts`, `.js` or `.mjs`. `defineConfig` gives you types and autocomplete. JSON Schemas for the report and the baseline ship in `@miraya/cli/schema/`.

## Commands

```sh
npx miraya                           # audit; writes a config first if there's none
npx miraya init                      # write a config for this project
npx miraya init --print              # show the config it would write, change nothing
npx miraya login                     # sign in by hand and save the session
npx miraya audit                     # audit the config routes
npx miraya audit -r /pricing         # just this route
npx miraya audit --crawl             # find routes by following links
npx miraya audit --rule not-mirrored # just this rule
npx miraya baseline update           # accept the current findings
npx miraya explain 3b390ba0          # the measurements behind one finding
npx miraya rules                     # list the rules
```

`audit` exits with `0` when there are no new errors, `1` when there are, and `2` when a page couldn't be audited (pass `--allow-errors` to report those without failing). In a terminal, `audit` opens the HTML report when it ends; `--no-open` stops that, and CI never opens it. Run `npx miraya audit --help` for every option.

## Pages behind a login

Sign in once, by hand, and Miraya reuses the session:

```sh
npx miraya login
```

A browser window opens on your app (at `auth.loginUrlPattern`, if set). Sign in as you normally would, then press Enter in the terminal, or close the window. Miraya saves the cookies and localStorage to `.miraya/auth.json` and tells you what to add to the config:

```ts
auth: { storageState: '.miraya/auth.json', loginUrlPattern: '/login' },
```

With `loginUrlPattern` set, a route that redirects to the login page fails with a clear error instead of auditing the login form, so an expired session is easy to spot: run `miraya login` again. The file signs in as you, so keep it out of git; `miraya init` adds `.miraya/` to `.gitignore`.

## Baselines

Adopting Miraya on an existing app usually turns up findings you can't fix today. Accept them:

```sh
npx miraya baseline update
```

This writes `.miraya-baseline.json`. Commit it. From then on, accepted findings show as "known" in the report and don't fail the run; only new ones do. When you fix one, the report lists it as fixed. Findings are matched by what they are, not where they are, so moving an element doesn't make its finding new.

## Translation files

Point Miraya at your translation files, and each piece of English on the Arabic page comes with where to fix it:

```ts
locales: { ltr: './locales/en.json', rtl: './locales/ar.json' },
```

Miraya finds the English text's key in the English file and checks the Arabic one:

| In the report               | Means                                                          | Fix                                                                    |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Missing from** a file     | The key `checkout.payNow` isn't in the Arabic file             | Add it, translated                                                     |
| **Still English in**        | The Arabic file has the key, but its value is the English text | Translate the value                                                    |
| **Translated in**           | The Arabic file translates it, yet the page shows English      | Check that the Arabic file loads on that page, and the key in the code |
| **Not in** the English file | No key has this text                                           | It's written into a component: move it into the translation files      |

Each one is a JSON file (nested or flat keys), or a folder of JSON files with one per namespace, like `locales/en/checkout.json`. Keys from a folder are shown i18next-style, `checkout:payNow`. Placeholders such as `{name}`, `{{count}}` and `%s` match whatever the page filled in. ICU plural and select messages aren't matched yet. `miraya init` fills this in when it finds the files.

## What Miraya leaves out

- **Dev-server overlays.** Nuxt devtools, the Vue tracer, Next.js and Vite error overlays, and similar are skipped, since they aren't your app. Auditing a production build is still more faithful.
- **Repeated copies.** A mistake in a repeated component, like a card in a grid, is reported once, on the first copy, with the number of copies.
- **Pages that crashed.** If a page throws and draws no text, the route fails with the page's own error instead of reporting on an empty page.
- **Direction on a wrapper.** If `<html>` has no `dir` but the app's root element is right-to-left, `document-direction` asks you to move `dir` to `<html>`, and the other rules still run.

## Ignoring an element

When something is meant to stay put in RTL, mark it in your markup and say why:

```html
<aside data-rtl-ignore="not-mirrored: the chat launcher stays bottom-right by design">…</aside>
```

Separate several rules with `;`. The marker applies to the element and everything inside it. Markers without a reason, or naming a rule that doesn't exist, show up as notes in the report.

## Playwright

To check pages inside your existing Playwright tests, use [`@miraya/playwright`](https://www.npmjs.com/package/@miraya/playwright):

```ts
import { test } from '@playwright/test'
import { rtl } from '@miraya/playwright'

test('checkout has no RTL bugs', async ({ page }) => {
  await rtl.expectClean(page, { url: '/checkout' })
})
```

## GitHub Actions

Copy [`examples/github-action/miraya.yml`](https://github.com/omaritooo/miraya/blob/main/examples/github-action/miraya.yml) into `.github/workflows/`. On GitHub Actions, findings appear as annotations on the pull request and in the job summary, and the HTML report is uploaded as an artifact.

The example serves the production build itself, so the `server` command in your config isn't run: an app that's already answering at `baseUrl` is used as it is. Run it in the Playwright container image, as the example does. It pins the system fonts, so screenshots and baselines stay the same from run to run.

## Rules

| Rule                                              | Default | Finds                                                           |
| ------------------------------------------------- | ------- | --------------------------------------------------------------- |
| [`document-direction`](#document-direction)       | error   | The Arabic page doesn't set `dir="rtl"` and `lang`              |
| [`not-mirrored`](#not-mirrored)                   | error   | Elements that stay on the same side in RTL                      |
| [`icon-direction`](#icon-direction)               | error   | Directional icons pointing the wrong way                        |
| [`arabic-letter-spacing`](#arabic-letter-spacing) | error   | Letter-spacing on Arabic text                                   |
| [`fallback-font`](#fallback-font)                 | warn    | Arabic drawn in a font you didn't choose                        |
| [`clipped-text`](#clipped-text)                   | warn    | Arabic text cut off by its box                                  |
| [`untranslated-text`](#untranslated-text)         | warn    | English left in the Arabic page                                 |
| [`ltr-inputs`](#ltr-inputs)                       | warn    | Email, URL and phone fields typed right to left                 |
| [`mixed-digits`](#mixed-digits)                   | info    | Western and Arabic-Indic digits on the same page                |
| [`bidi-isolation`](#bidi-isolation)               | warn    | Phone numbers, prices and URLs scrambled by bidi (experimental) |

Change a rule's severity or options under `rules` in the config.

### `document-direction`

The Arabic page must declare itself: `<html lang="ar" dir="rtl">`. Without `dir`, the browser lays the page out left to right. Without `lang`, screen readers read Arabic with the wrong voice, and the browser can't pick the right fonts.

**Fix:** set both on the root element of the Arabic page.

### `not-mirrored`

An element is in the same place in both directions when it should have moved to the other side: a sidebar still on the left, a badge still at the top right. Miraya measures each element's gap to its nearest neighbour and to its container in both renders, and reports it when the gaps don't swap sides. It also checks that siblings in a row reverse their order.

**Fix:** use logical CSS. `inset-inline-start` instead of `left`, `margin-inline-start` instead of `margin-left`, `text-align: start` instead of `left`. Flexbox and grid flip on their own.

**Options:** `tolerancePx` (4), `tolerancePct` (0.02 of the container), `minWidth` (8). Elements meant to stay put take a [`data-rtl-ignore`](#ignoring-an-element) marker.

### `icon-direction`

Arrows, chevrons, "back", "next", "send" and "log out" icons point in a direction, and in RTL that direction should flip. Icons that aren't directional (a search magnifier, a play button, a clock) shouldn't flip. Miraya compares each icon's pixels between the renders and reports directional icons that didn't flip, and other icons that did.

**Fix:** flip directional icons in RTL, for example `[dir='rtl'] .icon-arrow { transform: scaleX(-1) }`, and remove flips from icons that must keep their orientation.

**Options:** `symmetricBelow` (0.1), `sameBelow` (0.15), `minSize` (12).

### `arabic-letter-spacing`

Arabic letters join to each other. Letter-spacing pulls them apart, which breaks the joins and makes words hard to read. It usually comes from a heading or button style written for English.

**Fix:** set `letter-spacing: 0` for Arabic text, for example `:lang(ar) { letter-spacing: 0 }`.

**Options:** `minArabicRatio` (0.5): how much of the text has to be Arabic.

### `fallback-font`

Arabic text was drawn in a font from the operating system, not one you chose, so it looks different on every machine. Miraya asks the browser which font actually drew the glyphs. A common cause is buttons and inputs, which don't inherit fonts by default.

**Fix:** load a font with Arabic glyphs and add it to the font stack. Give form controls `font: inherit`. List your Arabic fonts in `fonts.arabic`.

### `clipped-text`

Arabic text is cut off by its box. Arabic letters reach higher and lower than Latin ones, and Arabic labels are often longer, so a box sized for English can clip them.

**Fix:** a larger `line-height`, no fixed heights on text, and widths that grow with the label.

### `untranslated-text`

English text in the Arabic page, usually a string that missed translation.

**Fix:** translate the string. Brand and product names that stay in English go in `allow.latinText`. With [translation files](#translation-files) set up, each finding says which key to fix and in which file.

**Options:** `minWords` (2): shorter text is ignored.

### `ltr-inputs`

Emails, URLs, phone numbers and codes are written left to right even in Arabic. In an RTL field, the cursor and punctuation jump around while people type them.

**Fix:** add `dir="ltr"` to those inputs. Their labels stay Arabic.

### `mixed-digits`

The page uses Western digits (123) in some places and Arabic-Indic digits (١٢٣) in others. Either is fine; mixing them looks unfinished.

**Fix:** format every number with one locale, for example `Intl.NumberFormat('ar-EG')` everywhere.

**Options:** `prefer`: `'western'` or `'arabic-indic'`, to report every digit of the other kind.

### `bidi-isolation`

Experimental: switch it on with `experimental: ['bidi-isolation']`.

A phone number, price, email, URL or English phrase inside Arabic text can be displayed in a scrambled order by the Unicode bidi algorithm: `+20 100 123 4567` shows as `4567 123 100 +20`. Miraya runs the algorithm on the text and reports runs that display differently from how they're written.

**Fix:** wrap the run in `<bdi>`, or in an element with `dir="ltr"`.

**Options:** `families`: which kinds to check, from `phone`, `price`, `email`, `url` and `latin-phrase`.

## SEO

Miraya reads the tags search engines and link previews use, from both renders, and the response headers of each page. The report's SEO tab shows them side by side, with each page's search result as the tags draw it. A problem on both languages is one finding; one that only the Arabic page has says so.

| Rule                                    | Default | Finds                                                              |
| --------------------------------------- | ------- | ------------------------------------------------------------------ |
| [`page-title`](#page-title)             | error   | A missing title; one too long, too short, or left in English       |
| [`meta-description`](#meta-description) | warn    | A missing description; one too long, too short, or left in English |
| [`robots-noindex`](#robots-noindex)     | error   | `noindex` in the robots meta tag or the `X-Robots-Tag` header      |
| [`canonical`](#canonical)               | error   | A missing canonical, several, or one that names the other language |
| [`hreflang`](#hreflang)                 | warn    | Language links that don't connect the English and Arabic pages     |
| [`single-h1`](#single-h1)               | warn    | No `<h1>`, or several                                              |
| [`social-preview`](#social-preview)     | info    | Missing `og:title`, `og:description` or `og:image`                 |
| [`structured-data`](#structured-data)   | error   | JSON-LD that isn't valid JSON, or has no `@type`                   |
| [`duplicate-title`](#duplicate-title)   | warn    | Pages that share a title or description                            |

SEO rules run on every page, whether or not its Arabic render is right to left. Switch the area off with `checks: ['localization']`.

### `page-title`

Search results show a page's `<title>` as the link, and cut it after about 60 characters. Each language needs its own.

**Fix:** give every page its own title in its own language, under 60 characters, with the most specific words first.

**Options:** `maxLength` (60), `minLength` (10).

### `meta-description`

Search results quote the meta description under the title, up to about 160 characters. Without one, they quote whatever text they pick.

**Fix:** write a description of 50 to 160 characters for each page, translated for each language.

**Options:** `maxLength` (160), `minLength` (50).

### `robots-noindex`

`noindex`, in `<meta name="robots">` or the `X-Robots-Tag` header, takes a page out of search results. On a development server (`localhost`, `*.local`, `*.test`, private addresses) that's usually on purpose, so there it's reported as info and doesn't fail the run.

**Fix:** remove `noindex` from pages meant to be found. Keep it on dev and preview servers.

### `canonical`

The canonical link names the one URL a page should be found under. When the Arabic page names the English one, search engines treat the Arabic page as a copy and drop it. Several canonicals are ignored altogether.

**Fix:** build the canonical from the current page's URL, locale included, so each language points at itself.

### `hreflang`

`<link rel="alternate" hreflang>` tells search engines which page to show readers of each language. Each page should list every language version, itself included, with the right language code, plus an `x-default`. Apps that serve both languages from one URL (cookie, storage or attribute switches) can't use hreflang, so the rule skips them.

**Fix:** on every page, link each language version and one `hreflang="x-default"`.

### `single-h1`

A page's `<h1>` names its main topic for search engines and screen readers.

**Fix:** give each page one `<h1>`; use `<h2>` and below for sections.

### `social-preview`

Chat apps and social networks draw shared links from the Open Graph tags. Without them, the preview has no image and guessed text.

**Fix:** add `og:title`, `og:description` and `og:image` (an absolute URL, 1200×630) to each page, in its own language.

### `structured-data`

JSON-LD (`<script type="application/ld+json">`) describes a page to search engines: a product, an article, an organisation. A block that isn't valid JSON is ignored, and one without `@type` says nothing.

**Fix:** make each block valid JSON with an `@type`, and check it with a structured data validator.

### `duplicate-title`

Search results can't tell pages with the same title apart, and may show only one. This rule compares every audited page, per language, once the run is done. The report's SEO tab lists all titles and descriptions under **Site**, with the shared ones grouped, next to a table of each page's language links.

**Fix:** give each page a title and description of its own, naming what's on it.

## Performance

Miraya loads each page in both languages again, in Chromium with the cache off and the CPU and network slowed down, and measures how fast it draws. The Arabic page is often the slower one: Arabic web fonts are several times the size of Latin ones, and a page that waits for its font paints late. The report's Performance tab shows both languages against the budgets, the element that painted last, and where the bytes go.

It's off by default, because it loads each page several more times. Switch it on with `checks: ['localization', 'seo', 'performance']`, or `--checks localization,seo,performance` for one run.

| Rule                                    | Default | Finds                                                  |
| --------------------------------------- | ------- | ------------------------------------------------------ |
| [`lcp-budget`](#lcp-budget)             | error   | The largest element paints later than `budgets.lcpMs`  |
| [`cls-budget`](#cls-budget)             | warn    | Layout shift over `budgets.cls`                        |
| [`tbt-budget`](#tbt-budget)             | warn    | Scripts block the page for longer than `budgets.tbtMs` |
| [`js-budget`](#js-budget)               | warn    | More JavaScript than `budgets.scriptKb`                |
| [`render-blocking`](#render-blocking)   | warn    | More files holding up the first paint than allowed     |
| [`oversized-images`](#oversized-images) | info    | Images served larger than they're drawn                |

```ts
performance: {
  runs: 3, // measured loads per page and language; the median counts
  warmUp: 1, // loads before measuring, so a dev server's first compile doesn't count
  cpuSlowdown: 4,
  network: 'fast-4g', // or 'slow-4g', or 'none'
  budgets: { lcpMs: 2500, cls: 0.1, tbtMs: 200, scriptKb: 300, renderBlocking: 0 },
}
```

The defaults follow Core Web Vitals' "good" thresholds, under Chrome DevTools' Fast 4G preset. Numbers from a development server are slower and noisier than production; set budgets against a production build. A metric over budget in both languages is one finding, and its fingerprint doesn't change with the numbers, so a baseline keeps holding it as they move.

### `lcp-budget`

Largest Contentful Paint: when the biggest heading, image or text block in the first view finished drawing. The finding outlines that element on the screenshot.

**Fix:** find what the element waits for: a web font, a hero image or a script before it. Preload it, make it smaller, or let it draw first in a fallback font (`font-display: swap`). For Arabic fonts, a `unicode-range` subset of the Arabic block is often a fraction of the full file.

### `cls-budget`

Cumulative Layout Shift: how much the page moves while it loads, counted in the worst five-second window.

**Fix:** reserve space for what arrives late: `width` and `height` on images, a `min-height` on banners and embeds, and fallback-font metrics (`size-adjust`) that match the web font.

### `tbt-budget`

Total Blocking Time: how long, after the first paint, scripts kept the page from responding to a tap, counting each task's time past 50 ms.

**Fix:** split long tasks, defer scripts the first view doesn't need, and move heavy work off the main thread.

### `js-budget`

The JavaScript the page downloads, compressed, as it crosses the network.

**Fix:** split the bundle by route, load rarely used features on demand, and look for duplicate or oversized dependencies.

### `render-blocking`

Stylesheets and scripts in the `<head>` that the browser must load before it draws anything. Allowed: `budgets.renderBlocking` (0).

**Fix:** inline the CSS the first view needs and load the rest later; add `defer` or `async` to scripts in the head.

### `oversized-images`

Images whose file is larger than the space they're drawn in, by at least 4 KB of wasted bytes.

**Fix:** serve each image at the size it's drawn, with `srcset` and `sizes` for different screens.

## Cross-browser

Safari and Firefox lay some right-to-left pages out differently from Chrome. List the engines, and Miraya audits every page in each of them:

```ts
browsers: ['chromium', 'webkit', 'firefox'],
```

The report's Cross-browser tab lists the findings only some engines saw, such as a badge that only WebKit leaves on the wrong side, with Chromium's Arabic render beside that engine's, and a table of each page's findings by engine. Those findings also show in their area's tab, tagged with the engines, and they fail the run like any other. An engine that can't load a page makes the run incomplete (exit 2).

Chromium leads: it draws the main screenshots and runs the performance check. Firefox and WebKit skip `fallback-font`, which asks Chromium which font drew the text, and that isn't counted as a difference. Each engine is about 100 MB to download, once (the CLI does it on first use), and adds its own render of every page to the run time. Inside a Playwright test, the helper audits in the test's own browser only.

## Using it from code

```ts
import { chromium } from '@playwright/test'
import { audit, parseConfig, writeHtmlReport } from '@miraya/cli'

const config = parseConfig({ baseUrl: 'http://localhost:3000', routes: ['/'] })
const browser = await chromium.launch()
const report = await audit({ config, browser, outDir: '.miraya' })
await browser.close()
writeHtmlReport(report, '.miraya')
```

## License

MIT
