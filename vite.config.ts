import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Local Clock-compatible replacement for the THREE.Clock deprecation in r183.
 * @react-three/fiber uses Clock's `start`, `stop`, `getDelta`, `elapsedTime`,
 * and `oldTime` members, which Timer doesn't expose the same way, so we
 * substitute an inline object with the same surface that uses `performance.now`.
 */
const CLOCK_REPLACEMENT = `(() => {
  const startTime = performance.now();
  return {
    autoStart: true,
    startTime,
    oldTime: startTime,
    elapsedTime: 0,
    running: false,
    start() {
      this.startTime = performance.now();
      this.oldTime = this.startTime;
      this.elapsedTime = 0;
      this.running = true;
    },
    stop() {
      this.getElapsedTime();
      this.running = false;
      this.autoStart = false;
    },
    getElapsedTime() {
      this.getDelta();
      return this.elapsedTime;
    },
    getDelta() {
      let diff = 0;
      if (this.autoStart && !this.running) {
        this.start();
        return 0;
      }
      if (this.running) {
        const now = performance.now();
        diff = (now - this.oldTime) / 1000;
        this.oldTime = now;
        this.elapsedTime += diff;
      }
      return diff;
    },
  };
})()`

function transformSource(id: string, code: string): string | null {
  // @dimforge/rapier3d-compat: its init() wrapper calls the wasm initializer
  // with a positional Uint8Array, which the same file deprecates. Rewrite to
  // pass `{ module_or_path: ... }` so the deprecation branch is not taken.
  //
  // The file embeds a ~2 MB base64 wasm string, so regex backtracking is not
  // viable. Walk positionally: find the `.toByteArray("AGFzbQ` marker, scan
  // back to the enclosing `xA(` (or whatever the minified name is) open
  // paren, then forward to the matching close paren, and wrap with
  // `{ module_or_path: ... }`.
  if (id.includes('@dimforge/rapier3d-compat') && id.endsWith('rapier.mjs')) {
    const marker = '.toByteArray("AGFzbQ'
    const markerIdx = code.indexOf(marker)
    if (markerIdx >= 0) {
      // Walk back from `.toByteArray(...` to the open paren of the caller.
      // Shape in the minified source: `xA(lg.toByteArray("...")`.
      let openIdx = markerIdx
      while (openIdx > 0 && code[openIdx] !== '(') openIdx--
      // openIdx is now at the `(` after the outer identifier (e.g. `xA(`).
      // Walk forward from that `(` to its matching `)`.
      let depth = 0
      let closeIdx = openIdx
      let inString = false
      for (; closeIdx < code.length; closeIdx++) {
        const ch = code[closeIdx]
        if (inString) {
          if (ch === '\\') {
            closeIdx++
            continue
          }
          if (ch === '"') inString = false
          continue
        }
        if (ch === '"') inString = true
        else if (ch === '(') depth++
        else if (ch === ')') {
          depth--
          if (depth === 0) break
        }
      }
      if (closeIdx < code.length) {
        // Wrap the inner expression with `{module_or_path: ...}`.
        const inner = code.slice(openIdx + 1, closeIdx)
        return (
          code.slice(0, openIdx + 1) +
          '{module_or_path:' +
          inner +
          '}' +
          code.slice(closeIdx)
        )
      }
    }
  }

  // @react-three/fiber: replace `new THREE.Clock()` with a local replacement
  // that mimics Clock's API without triggering three's deprecation warning.
  if (
    id.includes('@react-three/fiber') &&
    /\.(mjs|js)$/.test(id) &&
    code.includes('new THREE.Clock()')
  ) {
    return code.replace(/new THREE\.Clock\(\)/g, CLOCK_REPLACEMENT)
  }

  return null
}

/**
 * Rolldown plugin applied during Vite's dep pre-bundling step. Fixes two
 * upstream deprecation warnings without touching node_modules on disk.
 */
function upstreamDeprecationFixesRolldown() {
  return {
    name: 'upstream-deprecation-fixes',
    transform(code: string, id: string) {
      const transformed = transformSource(id, code)
      if (transformed !== null && transformed !== code) {
        return { code: transformed, map: null }
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    rolldownOptions: {
      plugins: [upstreamDeprecationFixesRolldown()],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
  },
})
