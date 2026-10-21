/**
 * La VR du navigateur : WebXR s'il sait faire (un casque, le navigateur du
 * Quest), sinon le Cardboard, par le polyfill WebXR de Google (stéréo, lentilles
 * corrigées, gyroscope, un tapotement pour « sélectionner »).
 *
 * L'accueil le lit pour savoir s'il propose la VR ; babylon/vr.ts ouvre lui-même
 * la session, DANS le geste du visiteur (`permettreGyroscope` d'abord), sinon le
 * navigateur la refuse.
 *
 * `?vr=cardboard` force le Cardboard sur un ordinateur (pour l'essayer, ou le
 * piloter en test).
 */

export type ModeVR = 'natif' | 'cardboard'

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

/**
 * La VR est-elle possible ici, et laquelle ? Sur un téléphone sans VR native,
 * installe le polyfill Cardboard (un morceau à part, chargé seulement là).
 */
export function vrDisponible(): Promise<ModeVR | null> {
  disponible ??= (async () => {
    const forcer = new URLSearchParams(location.search).get('vr') === 'cardboard'
    const natif = !forcer && navigator.xr !== undefined && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))
    if (natif) return 'natif'
    const telephone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window
    if (!telephone && !forcer) return null
    if (navigator.xr !== undefined) retirerWebXRNatif()
    const { default: WebXRPolyfill } = await import('webxr-polyfill')
    new WebXRPolyfill({ cardboard: true, webvr: false, allowCardboardOnDesktop: forcer })
    const ok = navigator.xr !== undefined && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))
    return ok ? 'cardboard' : null
  })()
  return disponible
}

/** La permission du gyroscope (iOS), demandée dans le geste du visiteur ; ailleurs, rien. */
export function permettreGyroscope(): void {
  const permission = (globalThis.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined)?.requestPermission
  permission?.call(DeviceOrientationEvent).catch(() => {})
}

