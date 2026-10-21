import { z } from 'zod'
import type { ElementSnap, Finding } from '../types'
import { defineRule, isIgnored } from './util'

const ID = 'ltr-inputs'
const LTR_TYPES = new Set(['tel', 'email', 'url'])
const LTR_AUTOCOMPLETE = /^(tel.*|email|url|cc-number|cc-exp.*|cc-csc|one-time-code)$/
const LTR_NAME = /phone|mobile|email|otp|code|card|iban/i

/** Why an input holds left-to-right content, or undefined if it doesn't. */
function ltrReason(input: NonNullable<ElementSnap['input']>): string | undefined {
  if (LTR_TYPES.has(input.type)) return `type=${input.type}`
  const autocomplete = input.autocomplete?.split(/\s+/).pop()
  if (autocomplete && LTR_AUTOCOMPLETE.test(autocomplete)) return `autocomplete=${autocomplete}`
  if (input.inputMode && LTR_TYPES.has(input.inputMode)) return `inputmode=${input.inputMode}`
  if (input.name && LTR_NAME.test(input.name)) return `name=${input.name}`
  return undefined
}

export default defineRule({
  meta: { id: ID, defaultSeverity: 'warn', needs: 'rtl', fingerprintKeys: ['reason'], docs: ID },
  options: z.object({}),
  check(pair, ctx) {
    const findings: Finding[] = []
    for (const el of pair.rtl.elements) {
      if (!el.input || isIgnored(el, ID) || el.style.direction !== 'rtl') continue
      // An explicit dir="rtl" on the input or an ancestor is a deliberate choice.
      if (el.explicitDir === 'rtl') continue
      const reason = ltrReason(el.input)
      if (!reason) continue
      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: el.selector,
          el,
          boxes: { rtl: el.box },
          message: `This input (${reason}) holds left-to-right content but is typed right-to-left. Add dir="ltr".`,
          evidence: { reason, type: el.input.type, direction: el.style.direction },
        }),
      )
    }
    return findings
  },
})
