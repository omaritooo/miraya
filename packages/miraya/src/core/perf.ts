import type { BrowserContext, Page } from '@playwright/test'
import type { Dir, PagePerf, ResolvedConfig, ResourceType } from '../types'
import { open } from './render'

/** Chrome DevTools' presets, so numbers compare with what developers see there. */
const NETWORKS = {
  'fast-4g': {
    latency: 165,
    downloadThroughput: (9e6 / 8) * 0.9,
    uploadThroughput: (1.5e6 / 8) * 0.9,
  },
  'slow-4g': {
    latency: 562.5,
    downloadThroughput: (1.6e6 / 8) * 0.9,
    uploadThroughput: (750e3 / 8) * 0.9,
  },
} as const

export const NETWORK_NAMES: Record<ResolvedConfig['performance']['network'], string> = {
  'fast-4g': 'Fast 4G',
  'slow-4g': 'Slow 4G',
  none: 'Unthrottled',
}

// Lighthouse ignores images that waste less than this.
const MIN_WASTED_BYTES = 4096
const MAX_RESOURCES = 200
const QUIET_MS = 1000
const IDLE_CAP_MS = 10_000

/** Hot-reload clients that only development servers send: Vite, Next.js, webpack, Nuxt. */
const DEV_CLIENTS = [
  /\/@vite\/client\b/,
  /\/@react-refresh\b/,
  /\/_next\/static\/webpack\//,
  /webpack-hmr|\.hot-update\.(js|json)\b/,
  /\/_nuxt\/@vite\//,
]

const CDP_TYPES: Record<string, ResourceType> = {
  Document: 'document',
  Script: 'script',
  Stylesheet: 'style',
  Font: 'font',
  Image: 'image',
}

/**
 * Installed before the page's own scripts: paint, layout shift and long-task observers.
 * Kept free of named inner functions, since it's serialised into the page as source.
 */
function observe() {
  if (window !== window.top) return
  const m = {
    lcp: undefined as (PerformanceEntry & { element?: Element | null; url?: string }) | undefined,
    cls: 0,
    longTasks: [] as [number, number][],
  }
  ;(window as unknown as { __mirayaPerf: typeof m }).__mirayaPerf = m
  const watch = (type: string, each: (e: PerformanceEntry) => void) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(each)).observe({
        type,
        buffered: true,
      })
    } catch {
      // Not every engine reports every entry type.
    }
  }
  watch('largest-contentful-paint', (e) => {
    m.lcp = e
  })
  let window_ = 0
  let first = 0
  let last = 0
  watch('layout-shift', (e) => {
    const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean }
    if (shift.hadRecentInput) return
    if (window_ && shift.startTime - last < 1000 && shift.startTime - first < 5000) {
      window_ += shift.value
    } else {
      window_ = shift.value
      first = shift.startTime
    }
    last = shift.startTime
    m.cls = Math.max(m.cls, window_)
  })
  watch('longtask', (e) => m.longTasks.push([e.startTime, e.duration]))
}

type InPage = {
  lcp?: {
    ms: number
    selector?: string
    box?: { x: number; y: number; w: number; h: number }
    url?: string
  }
  fcpMs?: number
  cls: number
  tbtMs: number
  blocking: string[]
  images: {
    url: string
    selector: string
    natural: { w: number; h: number }
    shown: { w: number; h: number }
  }[]
}

function read(): InPage {
  const m = (
    window as unknown as {
      __mirayaPerf?: {
        lcp?: PerformanceEntry & { element?: Element | null; url?: string }
        cls: number
        longTasks: [number, number][]
      }
    }
  ).__mirayaPerf
  const selector = (el: Element) => {
    const parts: string[] = []
    for (let n: Element | null = el; n && parts.length < 4; n = n.parentElement) {
      if (n.id) {
        parts.unshift(`${n.localName}#${CSS.escape(n.id)}`)
        break
      }
      const classes = [...n.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`)
      parts.unshift(n.localName + classes.join(''))
      if (n.localName === 'body') break
    }
    return parts.join(' > ')
  }
  const box = (el: Element) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
  }
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime
  const tbtMs = (m?.longTasks ?? [])
    .filter(([start]) => fcp === undefined || start >= fcp)
    .reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0)
  const lcp = m?.lcp
  const element = lcp?.element?.isConnected ? lcp.element : undefined
  const dpr = devicePixelRatio
  return {
    ...(lcp
      ? {
          lcp: {
            ms: lcp.startTime,
            ...(element ? { selector: selector(element), box: box(element) } : {}),
            ...(lcp.url ? { url: lcp.url } : {}),
          },
        }
      : {}),
    ...(fcp !== undefined ? { fcpMs: fcp } : {}),
    cls: m?.cls ?? 0,
    tbtMs,
    blocking: (
      performance.getEntriesByType('resource') as (PerformanceResourceTiming & {
        renderBlockingStatus?: string
      })[]
    )
      .filter((e) => e.renderBlockingStatus === 'blocking')
      .map((e) => e.name),
    images: [...document.images]
      .filter(
        (img) =>
          img.complete &&
          img.naturalWidth > 0 &&
          img.currentSrc &&
          !img.currentSrc.startsWith('data:'),
      )
      .flatMap((img) => {
        const r = img.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return []
        return [
          {
            url: img.currentSrc,
            selector: selector(img),
            natural: { w: img.naturalWidth, h: img.naturalHeight },
            shown: { w: Math.ceil(r.width * dpr), h: Math.ceil(r.height * dpr) },
          },
        ]
      }),
  }
}

type Load = Omit<PagePerf, 'runs'>

async function loadOnce(
  context: BrowserContext,
  route: string,
  dir: Dir,
  config: ResolvedConfig,
): Promise<Load> {
  const { cpuSlowdown, network } = config.performance
  const page: Page = await context.newPage()
  try {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    if (network !== 'none') {
      await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORKS[network] })
    }
    if (cpuSlowdown > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown })
    const requests = new Map<string, { url: string; type: ResourceType; bytes: number }>()
    let lastActivity = Date.now()
    cdp.on('Network.responseReceived', (e) => {
      lastActivity = Date.now()
      if (e.response.url.startsWith('data:')) return
      requests.set(e.requestId, {
        url: e.response.url,
        type: CDP_TYPES[e.type] ?? 'other',
        bytes: 0,
      })
    })
    cdp.on('Network.loadingFinished', (e) => {
      lastActivity = Date.now()
      const request = requests.get(e.requestId)
      if (request) request.bytes = Math.round(e.encodedDataLength)
    })
    await page.addInitScript(observe)
    await open(page, route, dir, config)
    // Wait for the network and the main thread to go quiet, so late long tasks and shifts count.
    const start = Date.now()
    while (Date.now() - lastActivity < QUIET_MS && Date.now() - start < IDLE_CAP_MS) {
      await page.waitForTimeout(200)
    }
    const measured = await page.evaluate(read)

    const list = [...requests.values()]
    const byUrl = new Map(list.map((r) => [r.url, r]))
    const bytes: Record<ResourceType, number> = {
      document: 0,
      script: 0,
      style: 0,
      font: 0,
      image: 0,
      other: 0,
    }
    for (const r of list) bytes[r.type] += r.bytes
    const blocking = new Set(measured.blocking)
    const oversizedImages = measured.images.flatMap((img) => {
      const file = byUrl.get(img.url)?.bytes ?? 0
      const shown = Math.min(1, (img.shown.w * img.shown.h) / (img.natural.w * img.natural.h))
      const wastedBytes = Math.round(file * (1 - shown))
      return wastedBytes >= MIN_WASTED_BYTES ? [{ ...img, bytes: file, wastedBytes }] : []
    })
    const devServer = list.some((r) => DEV_CLIENTS.some((re) => re.test(r.url)))
    return {
      ...(devServer ? { devServer } : {}),
      ...(measured.lcp ? { lcp: measured.lcp } : {}),
      ...(measured.fcpMs !== undefined ? { fcpMs: measured.fcpMs } : {}),
      cls: measured.cls,
      tbtMs: measured.tbtMs,
      requests: list.length,
      bytes,
      renderBlocking: list
        .filter((r) => blocking.has(r.url))
        .map(({ url, type, bytes }) => ({ url, type, bytes })),
      // One entry per image file, the most wasteful drawing of it.
      oversizedImages: [
        ...new Map(
          oversizedImages.sort((a, b) => a.wastedBytes - b.wastedBytes).map((i) => [i.url, i]),
        ).values(),
      ].sort((a, b) => b.wastedBytes - a.wastedBytes),
      resources: list
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, MAX_RESOURCES)
        .map((r) => (blocking.has(r.url) ? { ...r, blocking: true } : r)),
    }
  } finally {
    await page.close()
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] as number
}

/**
 * Loads the route cold, throttled, warm-up plus runs times, and keeps the median of each
 * metric. The paint details come from the run whose LCP was the median one.
 */
export async function measureRoute(
  context: BrowserContext,
  route: string,
  dir: Dir,
  config: ResolvedConfig,
): Promise<PagePerf> {
  const { runs, warmUp } = config.performance
  for (let i = 0; i < warmUp; i++) await loadOnce(context, route, dir, config)
  const loads: Load[] = []
  for (let i = 0; i < runs; i++) loads.push(await loadOnce(context, route, dir, config))
  const lcpMs = median(loads.map((l) => l.lcp?.ms ?? Infinity))
  const typical = loads.find((l) => (l.lcp?.ms ?? Infinity) === lcpMs) ?? (loads[0] as Load)
  const fcps = loads.flatMap((l) => (l.fcpMs === undefined ? [] : [l.fcpMs]))
  return {
    ...typical,
    ...(fcps.length ? { fcpMs: Math.round(median(fcps)) } : {}),
    ...(typical.lcp ? { lcp: { ...typical.lcp, ms: Math.round(typical.lcp.ms) } } : {}),
    cls: Math.round(median(loads.map((l) => l.cls)) * 1000) / 1000,
    tbtMs: Math.round(median(loads.map((l) => l.tbtMs))),
    runs,
  }
}

/** Throttling and long-task timing need the Chrome DevTools Protocol. */
export const canMeasure = (context: BrowserContext) =>
  context.browser()?.browserType().name() === 'chromium'
