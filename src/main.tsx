import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Silence known upstream deprecation warnings we can't control:
// - THREE.Clock (used internally by @react-three/fiber)
// - Rapier init() positional params (called by @react-three/rapier)
const SILENCED_WARNINGS = [
  'THREE.Clock: This module has been deprecated',
  'using deprecated parameters for the initialization function',
]
const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  const first = args[0]
  if (typeof first === 'string' && SILENCED_WARNINGS.some((s) => first.includes(s))) return
  originalWarn(...args)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
