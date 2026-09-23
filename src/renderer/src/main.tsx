import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
// Before the first render, so nothing paints in the wrong colours.
import './theme'

// In development React traces every render onto the performance timeline, with
// a copy of the props that changed. With a library this size that tracing is
// what ran the window out of memory, so it is switched off: nothing else here
// measures anything, and the React DevTools profiler does not rely on it.
if (import.meta.env.DEV) {
  performance.measure = (() => undefined) as unknown as typeof performance.measure
}

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
