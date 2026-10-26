// Runs inside the page, in a CDP isolated world (ADR-010). Bundled to a string by
// scripts/bundle-collector.mjs, so it must not import runtime code from outside
// this folder. It only reads from the DOM, never writes, except for scrolling to
// the top so boxes are measured at scroll position (0, 0).

import type { Dir, ElementSnap } from '../../types'
import type { CollectorOptions, PageCollection } from '../protocol'

const SKIP_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'head',
  'meta',
  'link',
  'title',
  'base',
])
const LEAF_TAGS = new Set(['svg'])
// Overlays that dev servers and devtools inject: they aren't the app, and they sit at a
// fixed physical position in both directions.
const DEV_OVERLAY_TAGS = new Set([
  'nuxt-devtools-frame',
  'vite-error-overlay',
  'vite-plugin-checker-error-overlay',
  'nextjs-portal',
  'astro-dev-toolbar',
])
const DEV_OVERLAY_IDS = new Set([
  'vue-tracer-overlay',
  'nuxt-devtools-container',
  'nuxt-devtools-anchor',
  '__vue-devtools-container__',
  '__nuxt-devtools-container',
  '__next-build-watcher',
  '__next-prerender-indicator',
  'webpack-dev-server-client-overlay',
  'react-refresh-overlay',
  'svelte-inspector-host',
])
const ARABIC_LETTER = /(?=\p{Script=Arabic})\p{L}/gu
const LATIN_LETTER = /(?=\p{Script=Latin})\p{L}/gu
const ARABIC_INDIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/g
const WESTERN_DIGIT = /[0-9]/g
// Icon-library class patterns (DESIGN.md › Icons). The captured part is the icon name.
const ICON_CLASS = /^(?:lucide|fa|bi|ri|ph|heroicons?)-(.+)$/
const FA_STYLE = /^(solid|regular|light|thin|duotone|brands|sharp|fw|lg|xs|sm|[0-9]+x)$/
const MATERIAL_CLASS = /^material-(icons|symbols)/
const FONT_SAMPLES_PER_GROUP = 3
const FONT_SAMPLES_MAX = 150

/** Elements by walk index, for Node to resolve node handles (font lookup). */
let lastNodes: Element[] = []
export const nodeAt = (index: number) => lastNodes[index]

let canvas: CanvasRenderingContext2D | null | undefined
/** Height of the glyph ink, which overflow can clip even when the layout fits. */
function inkHeight(text: string, style: CSSStyleDeclaration): number | undefined {
  canvas ??= document.createElement('canvas').getContext('2d')
  if (!canvas) return undefined
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const m = canvas.measureText(text)
  return Math.round((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * 10) / 10
}

function iconOf(el: Element, rect: DOMRect): { name?: string; label?: string } | undefined {
  const tag = el.localName
  const classes = [...el.classList]
  const libraryClass = classes.some((c) => ICON_CLASS.test(c) || MATERIAL_CLASS.test(c))
  const smallImg =
    tag === 'img' &&
    rect.width <= 64 &&
    rect.height <= 64 &&
    rect.width / rect.height >= 0.5 &&
    rect.width / rect.height <= 2
  if (tag !== 'svg' && !smallImg && !libraryClass) return undefined

  let name = el.getAttribute('data-icon') ?? undefined
  if (!name) {
    for (const c of classes) {
      const m = ICON_CLASS.exec(c)
      if (m?.[1] && !FA_STYLE.test(m[1])) name = m[1]
    }
  }
  if (!name && classes.some((c) => MATERIAL_CLASS.test(c)))
    name = el.textContent?.trim() || undefined
  const label = el.getAttribute('aria-label') ?? undefined
  name ??=
    label ??
    (tag === 'svg' ? el.querySelector('title')?.textContent?.trim() || undefined : undefined)
  const icon: { name?: string; label?: string } = {}
  if (name) icon.name = name.toLowerCase()
  if (label) icon.label = label
  return icon
}

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link',
  article: 'article',
  aside: 'complementary',
  button: 'button',
  dialog: 'dialog',
  footer: 'contentinfo',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  header: 'banner',
  img: 'img',
  li: 'listitem',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  select: 'combobox',
  table: 'table',
  textarea: 'textbox',
  ul: 'list',
}

type Frame = {
  /** Path of this DOM node, for children to extend. */
  path: string
  /** CSS selector of this DOM node, for children to extend. */
  selector: string
  parentKey: string | undefined
  /** Collected ancestors, nearest last, for container lookup. */
  ancestors: { key: string; w: number }[]
  ignore: Record<string, string> | undefined
  explicitDir: Dir | undefined
  depth: number
}

function count(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit.split(/\s+/)[0]
  const tag = el.localName
  if (tag === 'a' && !el.hasAttribute('href')) return undefined
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'checkbox' || type === 'radio') return type
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
    return 'textbox'
  }
  return IMPLICIT_ROLES[tag]
}

function nameLengthOf(el: Element, role: string | undefined): number | undefined {
  const label =
    el.getAttribute('aria-label') ?? el.getAttribute('alt') ?? el.getAttribute('title') ?? null
  if (label !== null) return label.trim().length
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
    return text.trim().length
  }
  if (role === 'button' || role === 'link' || role === 'heading' || role === 'listitem') {
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length
  }
  return undefined
}

function directText(el: Element): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? ''
  }
  return text.replace(/\s+/g, ' ').trim()
}

function parseIgnore(value: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of value.split(';')) {
    const [rule, ...reason] = part.split(':')
    const id = rule?.trim()
    if (id) out[id] = reason.join(':').trim()
  }
  return out
}

function nthOfType(el: Element): number {
  let n = 1
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.localName === el.localName) n++
  }
  return n
}

function cssString(value: string) {
  return `"${value.replace(/["\\]/g, '\\$&')}"`
}

const H1_MAX = 120

/** The <head> tags search engines and link previews read, and the page's h1s. */
function collectHead(doc: Document): PageCollection['head'] {
  const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()
  const metaContent = (selector: string) => {
    const el = doc.querySelector(selector)
    return el ? squash(el.getAttribute('content')) : undefined
  }
  const absolute = (href: string) => {
    try {
      return new URL(href, doc.baseURI).href
    } catch {
      return href
    }
  }
  const social: Record<string, string> = {}
  for (const el of doc.querySelectorAll('meta[property], meta[name]')) {
    const name = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase()
    if (/^(og|twitter):/.test(name) && !(name in social)) {
      social[name] = squash(el.getAttribute('content'))
    }
  }
  const typesOf = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(typesOf)
    if (!value || typeof value !== 'object') return []
    const node = value as Record<string, unknown>
    const own = ([] as unknown[]).concat(node['@type'] ?? []).map(String)
    return [...own, ...typesOf(node['@graph'])]
  }
  const title = doc.querySelector('head title') ?? doc.querySelector('title')
  const description = metaContent('meta[name="description" i]')
  const robots = metaContent('meta[name="robots" i]')
  return {
    ...(title ? { title: squash(title.textContent) } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(robots !== undefined ? { robots: robots.toLowerCase() } : {}),
    canonical: [...doc.querySelectorAll('link[rel~="canonical" i][href]')].map((el) =>
      absolute(el.getAttribute('href') ?? ''),
    ),
    alternates: [...doc.querySelectorAll('link[rel~="alternate" i][hreflang][href]')].map((el) => ({
      hreflang: (el.getAttribute('hreflang') ?? '').toLowerCase(),
      href: absolute(el.getAttribute('href') ?? ''),
    })),
    social,
    jsonLd: [...doc.querySelectorAll('script[type="application/ld+json" i]')].map((el) => {
      try {
        return { types: typesOf(JSON.parse(el.textContent ?? '')) }
      } catch (error) {
        return { types: [], error: error instanceof Error ? error.message : String(error) }
      }
    }),
    h1: [...doc.querySelectorAll('h1')].map((el) => squash(el.textContent).slice(0, H1_MAX)),
  }
}

export function collect(options: CollectorOptions): PageCollection {
  const doc = document
  const root = doc.documentElement
  window.scrollTo(0, 0)

  const generated = options.generatedIdPatterns.map((p) => new RegExp(p))
  const isStableId = (id: string) => id !== '' && !generated.some((re) => re.test(id))
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const docWidth = { scroll: root.scrollWidth, client: root.clientWidth }

  const elements: ElementSnap[] = []
  const nodes: Element[] = []
  const markers: PageCollection['markers'] = []
  const fontGroups = new Map<string, number[]>()
  const stats = { visited: 0, collected: 0, skipped: 0, capped: false, errors: 0 }

  function visit(el: Element, frame: Frame) {
    if (stats.capped) return
    const tag = el.localName
    if (SKIP_TAGS.has(tag)) return
    if (tag === 'iframe' || DEV_OVERLAY_TAGS.has(tag) || DEV_OVERLAY_IDS.has(el.id)) {
      stats.skipped++
      return
    }
    stats.visited++

    let childFrame: Frame
    try {
      const style = getComputedStyle(el)
      if (style.display === 'none') {
        stats.skipped++
        return
      }

      const testId = el.getAttribute(options.testIdAttribute) ?? undefined
      const id = el.getAttribute('id') ?? ''
      let path: string
      let selector: string
      if (testId) {
        path = `[${testId}]`
        selector = `[${options.testIdAttribute}=${cssString(testId)}]`
      } else if (isStableId(id)) {
        path = `#${id}`
        selector = `#${CSS.escape(id)}`
      } else {
        const n = nthOfType(el)
        path = frame.path ? `${frame.path}>${tag}:${n}` : `${tag}:${n}`
        selector = frame.selector
          ? `${frame.selector} > ${tag}:nth-of-type(${n})`
          : `${tag}:nth-of-type(${n})`
      }

      const ignoreAttr = el.getAttribute('data-rtl-ignore')
      const own = ignoreAttr !== null ? parseIgnore(ignoreAttr) : undefined
      if (own) markers.push({ selector, rules: own })
      const ignore = own ? { ...frame.ignore, ...own } : frame.ignore
      // dir on <html> and <body> is the document direction, not an explicit island.
      const dirAttr = el.getAttribute('dir')?.toLowerCase()
      const explicitDir =
        tag !== 'html' && tag !== 'body' && (dirAttr === 'ltr' || dirAttr === 'rtl')
          ? dirAttr
          : frame.explicitDir

      const rect = el.getBoundingClientRect()
      const box = { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.width, h: rect.height }
      const offPage = box.x + box.w <= 0 || box.x >= docWidth.scroll
      const visible = box.w > 0 && box.h > 0 && style.visibility !== 'hidden' && !offPage

      childFrame = {
        path,
        selector,
        parentKey: frame.parentKey,
        ancestors: frame.ancestors,
        ignore,
        explicitDir,
        depth: frame.depth + 1,
      }

      if (visible) {
        const key = `e${elements.length}`
        let containerKey: string | undefined
        if (style.position === 'fixed') containerKey = 'viewport'
        else {
          for (let i = frame.ancestors.length - 1; i >= 0; i--) {
            const a = frame.ancestors[i]
            if (a && a.w > box.w + options.containerTolerancePx) {
              containerKey = a.key
              break
            }
          }
        }

        const text = directText(el)
        const role = roleOf(el)
        const snap: ElementSnap = {
          key,
          depth: frame.depth,
          path,
          selector,
          tag,
          box,
          style: {
            direction: style.direction === 'rtl' ? 'rtl' : 'ltr',
            transform: style.transform,
            letterSpacing: style.letterSpacing,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            unicodeBidi: style.unicodeBidi,
            display: style.display,
            position: style.position,
            justifyContent: style.justifyContent,
          },
          scroll: {
            sw: el.scrollWidth,
            cw: el.clientWidth,
            sh: el.scrollHeight,
            ch: el.clientHeight,
          },
        }
        if (frame.parentKey) snap.parentKey = frame.parentKey
        if (testId) snap.testId = testId
        if (role) snap.role = role
        const nameLength = nameLengthOf(el, role)
        if (nameLength !== undefined) snap.nameLength = nameLength
        if (containerKey) snap.containerKey = containerKey
        if (ignore) snap.ignore = ignore
        if (explicitDir) snap.explicitDir = explicitDir
        if (options.sourceAttribute) {
          const source = el.getAttribute(options.sourceAttribute)
          if (source) snap.sourceHint = source
        }

        if (text) {
          Object.assign(snap.style, {
            textAlign: style.textAlign,
            fontFamily: style.fontFamily,
            fontSize: parseFloat(style.fontSize),
            lineHeight: style.lineHeight,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          })
          const latin = count(text, LATIN_LETTER)
          const digits = {
            arabicIndic: count(text, ARABIC_INDIC_DIGIT),
            western: count(text, WESTERN_DIGIT),
          }
          snap.text = { arabic: count(text, ARABIC_LETTER), latin, digits }
          if (latin > 0 || digits.arabicIndic > 0 || digits.western > 0) {
            snap.text.value = text.slice(0, 200)
          }
          if (snap.text.arabic > 0) {
            if (style.overflowY === 'hidden' || style.overflowY === 'clip') {
              const ink = inkHeight(text, style)
              if (ink !== undefined) snap.text.inkHeight = ink
            }
            // Elements with the same style signature render with the same fonts, apart
            // from mixed-script text, so a few samples per signature are enough.
            const signature = [style.fontFamily, style.fontWeight, style.fontStyle, latin > 0].join(
              '|',
            )
            const group = fontGroups.get(signature) ?? []
            if (group.length < FONT_SAMPLES_PER_GROUP) group.push(elements.length)
            fontGroups.set(signature, group)
          }
        }

        const icon = iconOf(el, rect)
        if (icon) snap.icon = icon

        if (tag === 'input' || tag === 'textarea' || el.hasAttribute('contenteditable')) {
          snap.input = { type: (el.getAttribute('type') ?? tag).toLowerCase() }
          const name = el.getAttribute('name')
          const autocomplete = el.getAttribute('autocomplete')
          const inputMode = el.getAttribute('inputmode')
          if (name) snap.input.name = name
          if (autocomplete) snap.input.autocomplete = autocomplete
          if (inputMode) snap.input.inputMode = inputMode
        }

        elements.push(snap)
        nodes.push(el)
        stats.collected++
        childFrame.parentKey = key
        childFrame.ancestors = [...frame.ancestors, { key, w: box.w }]
        if (elements.length >= options.maxElements) {
          stats.capped = true
          return
        }
      } else {
        stats.skipped++
      }
    } catch {
      stats.errors++
      return
    }

    if (LEAF_TAGS.has(tag)) return
    const children = el.shadowRoot ? [...el.shadowRoot.children, ...el.children] : el.children
    for (const child of children) visit(child, childFrame)
  }

  visit(root, {
    path: '',
    selector: '',
    parentKey: undefined,
    ancestors: [],
    ignore: undefined,
    explicitDir: undefined,
    depth: 0,
  })

  lastNodes = nodes
  return {
    fontSamples: [...fontGroups.values()].flat().slice(0, FONT_SAMPLES_MAX),
    markers,
    dir: root.getAttribute('dir')?.toLowerCase() === 'rtl' ? 'rtl' : 'ltr',
    lang: root.getAttribute('lang') ?? '',
    viewport: { w: window.innerWidth, h: window.innerHeight },
    docHeight: root.scrollHeight,
    docWidth,
    elements,
    head: collectHead(doc),
    stats,
  }
}
