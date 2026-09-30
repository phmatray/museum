/** Le polyfill WebXR de Google (Cardboard), sans types publiés. */
declare module 'webxr-polyfill' {
  export default class WebXRPolyfill {
    constructor(config?: { cardboard?: boolean; webvr?: boolean; allowCardboardOnDesktop?: boolean; cardboardConfig?: unknown; global?: unknown })
    readonly nativeWebXR: boolean
    readonly injected: boolean
  }
}
