import './fonts.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import type { ReportData } from './data'

const data = JSON.parse(
  document.getElementById('miraya-data')?.textContent ?? 'null',
) as ReportData | null
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App data={data} />
    </StrictMode>,
  )
}
