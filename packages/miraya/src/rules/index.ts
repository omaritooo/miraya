import type { Rule } from '../types'
import arabicLetterSpacing from './arabic-letter-spacing'
import bidiIsolation from './bidi-isolation'
import clippedText from './clipped-text'
import documentDirection from './document-direction'
import fallbackFont from './fallback-font'
import iconDirection from './icon-direction'
import ltrInputs from './ltr-inputs'
import mixedDigits from './mixed-digits'
import notMirrored from './not-mirrored'
import untranslatedText from './untranslated-text'

export { defineRule } from './util'

/** Every built-in rule. document-direction runs first: when it fires, the others are skipped. */
export const builtinRules = [
  documentDirection,
  notMirrored,
  iconDirection,
  fallbackFont,
  arabicLetterSpacing,
  clippedText,
  untranslatedText,
  bidiIsolation,
  ltrInputs,
  mixedDigits,
] as Rule<unknown>[]
