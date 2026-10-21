// Le musée : Babylon.js, sans framework. `?moteur=babylon` (vieux liens) est simplement ignoré.
import './index.css'
import { demarrer } from './babylon/main.ts'

// `?diag=1` : les erreurs écrites à l'écran, pour un appareil sans console (un iPhone sans Mac).
if (new URLSearchParams(location.search).has('diag')) {
  const boite = document.createElement('pre')
  boite.style.cssText = 'position:fixed;inset:auto 0 0 0;max-height:50dvh;overflow:auto;margin:0;padding:8px;z-index:99999;background:#000c;color:#f88;font:11px/1.3 monospace;white-space:pre-wrap;pointer-events:auto'
  document.body.append(boite)
  const noter = (...a: unknown[]): void => { boite.textContent += a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack ?? ''}` : String(x))).join(' ') + '\n' }
  for (const k of ['error', 'warn'] as const) {
    const avant = console[k]
    console[k] = (...a: unknown[]) => { noter(k, ...a); avant.apply(console, a) }
  }
  addEventListener('error', (e) => noter('erreur', e.message, `${e.filename}:${e.lineno}`))
  addEventListener('unhandledrejection', (e) => noter('rejet', e.reason))
  noter('diag', navigator.userAgent, navigator.gpu ? 'WebGPU présent' : 'pas de WebGPU', `${innerWidth}×${innerHeight}@${devicePixelRatio}`)
}

demarrer(document.getElementById('root')!).catch((e: unknown) => console.error('démarrage', e))
