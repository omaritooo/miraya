import { clsBudget, jsBudget, lcpBudget, tbtBudget } from './budgets'
import oversizedImages from './oversized-images'
import renderBlocking from './render-blocking'

export const performanceRules = [
  lcpBudget,
  clsBudget,
  tbtBudget,
  jsBudget,
  renderBlocking,
  oversizedImages,
]
