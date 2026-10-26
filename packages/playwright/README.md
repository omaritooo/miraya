# @miraya/playwright

Check for right-to-left bugs inside your Playwright tests with [Miraya](https://www.npmjs.com/package/@miraya/cli).

```sh
npm install --save-dev @miraya/playwright @playwright/test
```

## Usage

```ts
import { test } from '@playwright/test'
import { rtl } from '@miraya/playwright'

const switchTo = { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' } as const

test('checkout has no RTL bugs', async ({ page }) => {
  await rtl.expectClean(page, { url: '/checkout', switchTo })
})
```

`expectClean` opens the route in LTR and RTL, runs Miraya's rules, and fails the test if there are new errors. The failure message lists each problem with the rule, the element and a link to the fix. The JSON report, the HTML report and both screenshots are attached to the test, so they show up in Playwright's HTML report and trace viewer.

The route is resolved against `use.baseURL` from your `playwright.config`. Miraya opens its own pages in the test's browser context, so `page` is free for the rest of the test, and a signed-in context stays signed in.

## Options

Both functions take the same options:

| Option          | What it does                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`           | The route to check.                                                                                                                                                                               |
| `switchTo`      | How your app switches direction. Defaults to `locale` in `miraya.config.ts`. See [the strategies](https://github.com/omaritooo/miraya/tree/main/packages/miraya#how-your-app-switches-direction). |
| `rules`         | Rule settings for this test, merged over the config: `{ 'mixed-digits': 'off' }`.                                                                                                                 |
| `baseline`      | A baseline file, or `false` to ignore baselines in this test.                                                                                                                                     |
| `rtlOnly`       | Skip the LTR render and the rules that need it.                                                                                                                                                   |
| `beforeCollect` | `async (page, dir) => {}`: runs once the page has settled, before measuring. Open a menu, dismiss a banner.                                                                                       |
| `config`        | Path to a config file, if it isn't `miraya.config.ts` in the working directory.                                                                                                                   |
| `failOn`        | `expectClean` only: the lowest severity that fails the test. `'error'` (default), `'warn'` or `'info'`.                                                                                           |
| `checks`        | The areas to check, such as `['localization', 'seo']`. Defaults to the config file's `checks`, else localization only.                                                                            |

To inspect findings yourself instead of failing:

```ts
const { route, newErrors } = await rtl.audit(page, { url: '/checkout' })
expect(route.findings.filter((f) => f.rule === 'not-mirrored')).toHaveLength(0)
```

`route` has the same shape as one route in Miraya's `report.json`.

Rules, config and baselines are documented in [Miraya's README](https://github.com/omaritooo/miraya/tree/main/packages/miraya#readme).

## License

MIT
