/**
 * Le mode photo, débloqué par l'appareil de la cabine de projection (`photoOuverte`, domain/succes.ts) :
 * la caméra quitte le visiteur et vole (domain/photo.ts), la scène peut se figer, une pellicule
 * étalonne l'image finie, et le déclencheur enregistre un PNG. Touche P, ou le bouton de l'interface.
 *
 * Figer : le temps du moteur s'arrête (`getDeltaTime` rend 0, que lisent les PNJ, Bavette, la faune,
 * les particules par le ratio d'animation de la scène) et les animations de Babylon avec lui ; la
 * caméra, elle, vole au temps réel.
 * ponytail : ce qui se règle sur l'horloge murale (le ciel, l'eau) continue ; à figer aussi s'il le faut.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { CreateScreenshotAsync } from '@babylonjs/core/Misc/screenshotTools'
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess'
import type { Scene } from '@babylonjs/core/scene'

import { neutre, PELLICULES, voler, type Pellicule } from '../domain/photo.ts'
import { photoOuverte } from '../domain/succes.ts'
import type { Walker } from '../plan/walk.ts'
import { partie, reglages, toucher } from './etat.ts'
import { langueDe } from './postTraitement.ts'
import { carnet } from './succes.ts'
import { el, svg } from './ui/dom.ts'
import './ui/photo.css'
import { SENSIBILITE, type monterVisiteur } from './visiteur.ts'

type Visiteur = ReturnType<typeof monterVisiteur>

const UNIFORMES = ['saturation', 'contraste', 'teinte', 'releve', 'grain', 'vignette', 'graine']

/** La passe de la pellicule, GLSL et WGSL, enregistrée au premier usage. */
function enregistrer(): void {
  if (ShaderStore.ShadersStore.pelliculePixelShader) return
  ShaderStore.ShadersStore.pelliculePixelShader = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float saturation;
uniform float contraste;
uniform vec3 teinte;
uniform float releve;
uniform float grain;
uniform float vignette;
uniform float graine;
float hasard(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + graine) * 43758.5453); }
void main(void) {
  vec4 s = texture2D(textureSampler, vUV);
  vec3 c = s.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contraste + 0.5;
  c *= teinte;
  c = releve + c * (1.0 - releve);
  c += (hasard(floor(vUV * vec2(1931.0, 1171.0))) - 0.5) * grain;
  c *= 1.0 - vignette * smoothstep(0.3, 0.85, length(vUV - 0.5) * 1.3);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), s.a);
}`
  ShaderStore.ShadersStoreWGSL.pelliculePixelShader = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform saturation: f32;
uniform contraste: f32;
uniform teinte: vec3f;
uniform releve: f32;
uniform grain: f32;
uniform vignette: f32;
uniform graine: f32;
fn hasard(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233)) + uniforms.graine) * 43758.5453); }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let s = textureSample(textureSampler, textureSamplerSampler, input.vUV);
  var c = s.rgb;
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = mix(vec3f(l), c, uniforms.saturation);
  c = (c - 0.5) * uniforms.contraste + 0.5;
  c *= uniforms.teinte;
  c = uniforms.releve + c * (1.0 - uniforms.releve);
  c += (hasard(floor(input.vUV * vec2f(1931.0, 1171.0))) - 0.5) * uniforms.grain;
  c *= 1.0 - uniforms.vignette * smoothstep(0.3, 0.85, length(input.vUV - 0.5) * 1.3);
  fragmentOutputs.color = vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), s.a);
}`
}

/** AAAAMMJJ-HHMMSS, à l'heure du visiteur : le nom du tirage. */
const horodatage = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('')
  + '-' + [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join('')

/** Monte le mode photo ; rend le bouton de l'interface (caché tant que l'appareil n'est pas pris). */
export function monterPhoto(scene: Scene, camera: Visiteur, toile: HTMLCanvasElement, racine: HTMLElement): HTMLButtonElement {
  const engine = scene.getEngine()
  const doigt = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

  // Le temps du moteur, coupé quand la scène est figée (tout ce qui lit getDeltaTime s'arrête).
  let fige = false
  const tempsReel = engine.getDeltaTime.bind(engine)
  engine.getDeltaTime = () => (fige ? 0 : tempsReel())

  let actif = false
  let rendu = 0
  let pos: [number, number, number] = [0, 0, 0]
  let cap = 0
  let tangage = 0
  let avant: { w: Walker; cap: number; tangage: number } | null = null
  let passe: PostProcess | null = null
  let pellicule: Pellicule = PELLICULES[0]

  const enfoncees = new Set<string>()
  const touche = (...codes: string[]) => Number(codes.some((c) => enfoncees.has(c)))

  // ── L'interface : la barre du mode, l'éclair du déclencheur, le bouton d'entrée ──
  const nom = el('span', { class: 'photo-pellicule', 'aria-live': 'polite' }, pellicule.nom)
  const bAvant = el('button', { type: 'button', 'aria-label': 'Pellicule précédente' }, '‹')
  const bApres = el('button', { type: 'button', 'aria-label': 'Pellicule suivante' }, '›')
  const bFiger = el('button', { type: 'button', 'aria-pressed': 'false' }, doigt ? 'Figer' : 'Figer (F)')
  const bDeclencher = el('button', { type: 'button', class: 'photo-declencheur' }, doigt ? 'Déclencher' : 'Déclencher (Entrée)')
  const bQuitter = el('button', { type: 'button' }, doigt ? 'Quitter' : 'Quitter (P)')
  const aide = el('p', { class: 'photo-aide' }, doigt
    ? 'Joystick : voler · glisser : regarder'
    : 'ZQSD : voler · souris : regarder · Espace / C : monter, descendre · Maj : vite · 1–6 : pellicule')
  const barre = el('div', { class: 'photo-barre', hidden: true, role: 'toolbar', 'aria-label': 'Mode photo' },
    el('div', { class: 'photo-choix' }, bAvant, nom, bApres), bFiger, bDeclencher, bQuitter, aide)
  const eclair = el('div', { class: 'photo-eclair', 'aria-hidden': 'true' })
  racine.append(barre, eclair)
  const bouton = el('button', { type: 'button', class: 'reglages-bouton', 'aria-label': 'Mode photo', title: 'Mode photo (P)', hidden: true },
    svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      svg('path', { d: 'M4 8h3l2-3h6l2 3h3v11H4z' }),
      svg('circle', { cx: 12, cy: 13, r: 3.5 })))
  const ouvert = () => photoOuverte(carnet.getState().carnet)
  const majBouton = () => (bouton.hidden = !ouvert())
  majBouton()
  carnet.subscribe(majBouton)

  // ── La pellicule : une passe en bout de chaîne, seulement quand elle change l'image ──
  const choisir = (p: Pellicule) => {
    pellicule = p
    nom.textContent = p.nom
    if (neutre(p) || !actif) {
      passe?.dispose(camera)
      passe = null
      return
    }
    if (passe) return
    enregistrer()
    passe = new PostProcess('pellicule', 'pellicule', UNIFORMES, null, 1, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null,
      Constants.TEXTURETYPE_UNSIGNED_BYTE, undefined, undefined, false, undefined, langueDe(engine))
    passe.onApply = (e) => {
      e.setFloat('saturation', pellicule.saturation)
      e.setFloat('contraste', pellicule.contraste)
      e.setFloat3('teinte', ...pellicule.teinte)
      e.setFloat('releve', pellicule.releve)
      e.setFloat('grain', pellicule.grain)
      e.setFloat('vignette', pellicule.vignette)
      // Le grain bouge à chaque image, sauf scène figée : la photo reste celle qu'on voit.
      if (!fige) rendu = (rendu + 1) % 997
      e.setFloat('graine', rendu)
    }
  }
  const decaler = (d: number) => choisir(PELLICULES[(PELLICULES.indexOf(pellicule) + d + PELLICULES.length) % PELLICULES.length])

  const figer = (oui: boolean) => {
    fige = oui
    scene.animationsEnabled = !oui
    bFiger.setAttribute('aria-pressed', String(oui))
  }

  const entrer = () => {
    if (actif || !ouvert() || partie.getState().enVR) return
    actif = true
    avant = { w: { ...camera.walker() }, cap: camera.rotation.y, tangage: camera.rotation.x }
    pos = [camera.position.x, camera.position.y, camera.position.z]
    ;[cap, tangage] = [avant.cap, avant.tangage]
    partie.setState({ photo: true, tourActive: false })
    document.documentElement.dataset.photo = ''
    barre.hidden = false
    choisir(pellicule)
  }
  const sortir = () => {
    if (!actif) return
    actif = false
    figer(false)
    choisir(pellicule)
    barre.hidden = true
    delete document.documentElement.dataset.photo
    enfoncees.clear()
    partie.setState({ photo: false })
    // Le visiteur reprend là où il s'était arrêté, le regard d'avant.
    if (avant) camera.placer({ ...avant.w, yaw: avant.cap, pitch: avant.tangage })
    avant = null
  }

  const declencher = async () => {
    if (!actif) return
    try {
      const image = await CreateScreenshotAsync(engine, camera, { precision: 1 })
      const lien = el('a', { href: image, download: `musee-${horodatage(new Date())}.png` })
      lien.click()
      eclair.classList.remove('flash')
      void eclair.offsetWidth
      eclair.classList.add('flash')
    } catch (e) {
      console.warn('photo impossible', e)
    }
  }

  bouton.addEventListener('click', (e) => {
    e.stopPropagation()
    // Depuis la pause (le billet), le clic rend la souris et la visite avant d'ouvrir le mode.
    if (partie.getState().paused) {
      Promise.resolve(toile.requestPointerLock?.()).catch(() => {})
      partie.setState({ paused: false })
    }
    entrer()
  })
  bAvant.addEventListener('click', () => decaler(-1))
  bApres.addEventListener('click', () => decaler(1))
  bFiger.addEventListener('click', () => figer(!fige))
  bDeclencher.addEventListener('click', () => void declencher())
  bQuitter.addEventListener('click', sortir)

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return
    if (!actif) {
      if (e.code === 'KeyP' && !e.repeat && !partie.getState().paused) entrer()
      return
    }
    enfoncees.add(e.code)
    if (e.repeat) return
    if (e.code === 'KeyP') sortir()
    else if (e.code === 'KeyF') figer(!fige)
    else if (e.code === 'Enter') void declencher()
    else if (/^Digit[1-6]$/.test(e.code)) choisir(PELLICULES[Number(e.code.slice(5)) - 1] ?? pellicule)
  })
  addEventListener('keyup', (e) => enfoncees.delete(e.code))
  addEventListener('blur', () => enfoncees.clear())
  addEventListener('mousemove', (e) => {
    if (!actif || document.pointerLockElement !== toile) return
    const { sensibilite, inverserY } = reglages.getState()
    cap -= e.movementX * SENSIBILITE * sensibilite
    tangage = Math.max(-1.5, Math.min(1.5, tangage - e.movementY * SENSIBILITE * sensibilite * (inverserY ? -1 : 1)))
  })
  // La pause (Échap : le verrou tombe, le billet revient) ou la VR referment le mode.
  partie.subscribe((s) => { if (actif && (s.paused || s.enVR)) sortir() })

  scene.onBeforeRenderObservable.add(() => {
    if (!actif) return
    const dt = Math.min(0.1, tempsReel() / 1000)
    // Le glissé du doigt (ui/mobile.ts), consommé ici tant que le mode tient la caméra.
    cap -= toucher.lookX * SENSIBILITE
    tangage = Math.max(-1.5, Math.min(1.5, tangage - toucher.lookY * SENSIBILITE))
    toucher.lookX = toucher.lookY = 0
    pos = voler(pos, cap, tangage, {
      avant: Math.max(-1, Math.min(1, touche('KeyW', 'ArrowUp') - touche('KeyS', 'ArrowDown') + toucher.forward)),
      cote: Math.max(-1, Math.min(1, touche('KeyD', 'ArrowRight') - touche('KeyA', 'ArrowLeft') + toucher.strafe)),
      haut: touche('Space', 'PageUp') - touche('KeyC', 'PageDown'),
      hate: touche('ShiftLeft', 'ShiftRight') > 0,
    }, dt)
    camera.position.copyFromFloats(...pos)
    camera.rotation.set(tangage, cap, 0)
  })

  return bouton
}

