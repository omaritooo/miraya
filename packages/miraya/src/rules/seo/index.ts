import canonical from './canonical'
import duplicateTitle from './duplicate-title'
import hreflang from './hreflang'
import metaDescription from './meta-description'
import pageTitle from './page-title'
import robotsNoindex from './robots-noindex'
import singleH1 from './single-h1'
import socialPreview from './social-preview'
import structuredData from './structured-data'

export const seoRules = [
  pageTitle,
  metaDescription,
  robotsNoindex,
  canonical,
  hreflang,
  singleH1,
  socialPreview,
  structuredData,
  duplicateTitle,
]
