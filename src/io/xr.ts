/**
 * La VR du navigateur : WebXR s'il sait faire (un casque, le navigateur du
 * Quest), sinon le Cardboard, par le polyfill WebXR de Google (stéréo, lentilles
 * corrigées, gyroscope, un tapotement pour « sélectionner »).
 *
 * Sans three ni React : l'accueil (HTML pur) le lit pour savoir s'il propose la
 * VR, et c'est son bouton qui ouvre la session — DANS le geste du visiteur, sans
 * rien attendre avant, sinon le navigateur la refuse. La scène (`VRLayer`) s'y
 * branche ensuite (`brancherVR`).
 *
 * `?vr=cardboard` force le Cardboard sur un ordinateur (pour l'essayer, ou le
 * piloter en test).
 */

export type ModeVR = 'natif' | 'cardboard'

type Brancher = (session: XRSession) => Promise<void>
let brancher: Brancher | null = null

/** La scène annonce qu'elle sait prendre une session (ou qu'elle ne le sait plus : `null`). */
export function brancherVR(f: Brancher | null): void {
  brancher = f
}

/**
 * Chrome (sur Android, sur ordinateur sans casque) a WebXR sans savoir faire de
 * VR : le polyfill ne s'installe que là où WebXR manque. On retire donc l'API
 * native, ses classes comprises — une session du polyfill ne se mélange pas avec
 * un `XRWebGLLayer` natif.
 */
function retirerWebXRNatif(): void {
  delete (Navigator.prototype as unknown as { xr?: unknown }).xr
  const g = window as unknown as Record<string, unknown>
  for (const nom of Object.getOwnPropertyNames(window)) if (/^XR[A-Z]/.test(nom)) delete g[nom]
  // Et `makeXRCompatible` : sans casque, celui de Chrome n'aboutit jamais, et le
  // polyfill ne pose le sien que là où il manque.
  for (const c of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) delete (c?.prototype as unknown as { makeXRCompatible?: unknown }).makeXRCompatible
}

let disponible: Promise<ModeVR | null> | null = null
let mode: ModeVR | null = null

/** La VR en cours de mise en place : native, ou le Cardboard du polyfill (qui ne sait pas lire un tapotement). */
export function modeVR(): ModeVR | null {
  return mode
}

/**
 * La VR est-elle possible ici, et laquelle ? Sur un téléphone sans VR native,
 * installe le polyfill Cardboard (un morceau à part, chargé seulement là).
 */
export function vrDisponible(): Promise<ModeVR | null> {
  disponible ??= (async () => {
    const forcer = new URLSearchParams(location.search).get('vr') === 'cardboard'
    const natif = !forcer && navigator.xr !== undefined && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))
    if (natif) return (mode = 'natif')
    const telephone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window
    if (!telephone && !forcer) return null
    if (navigator.xr !== undefined) retirerWebXRNatif()
    const { default: WebXRPolyfill } = await import('webxr-polyfill')
    new WebXRPolyfill({ cardboard: true, webvr: false, allowCardboardOnDesktop: forcer })
    const ok = navigator.xr !== undefined && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))
    return (mode = ok ? 'cardboard' : null)
  })()
  return disponible
}

/**
 * Dans le geste du visiteur : la permission du gyroscope (iOS) et la session
 * partent tout de suite, sans attente entre le clic et elles. La scène prend
 * ensuite la session ; sans scène prête, on la referme.
 */
export function entrerEnVR(): Promise<void> {
  const permission = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission
  permission?.().catch(() => {})
  const xr = navigator.xr
  if (xr === undefined) return Promise.reject(new Error('pas de WebXR'))
  return xr
    .requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] })
    .then((session) => (brancher ? brancher(session) : session.end()))
}
