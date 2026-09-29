/**
 * Le GRAPHE de l'ambiance : où l'on branche les voix de `synthe.ts`, comment
 * on les place dans l'espace et comment on les mêle.
 *
 *   pas ──────────────┬──────────────────────────────┐
 *                     ├─ envoi nef ──► salle 3,5 s ──┤
 *                     └─ envoi galerie ► salle 0,8 s ┤
 *   horloge, tableau, cloches ► 3D ► nef ─┬──────────┤
 *                                         └► salle 3,5 s
 *   eau, oiseaux ► 3D ─┐                              ├─► maître 0,6 ► limiteur ► sortie
 *   vent, grillons ────┴► dehors (jour / nuit) ──────┤
 *   ronron ► 3D ─────────────────────────────────────┤
 *   pluie ► passe-bas (selon le lieu) ───────────────┘
 *
 * Les poids viennent de `mixage()` (domain/son.ts) et sont rejoints en douceur :
 * passer la porte est un fondu d'une seconde.
 */
import { mixage, pluieEntendue, volumeRonron, type Coup, type Lieu, type Matiere } from '../domain/son'
import { TRACE_RUISSEAU, LEVRE } from '../plan/jardin'
import type { PlantPlacement } from '../plan/park'
import { cloche, eau, grillons, oiseau, pas, pluie, ronron, salle, tic, vent, volets } from './synthe'

/** Sous la verrière, le cadran nord (`build-nef.py`) et le tableau des départs dessous. */
const HORLOGE: Vec = [24, 14.8, 12.6]
const TABLEAU: Vec = [24, 11.2, 12.95]
/** Le chant vient d'un érable à moins de 35 m, perché à 5 m. */
const PORTEE_OISEAUX = 35
/** Constante de temps des fondus de mélange, en secondes. */
const FONDU = 0.5

type Vec = [number, number, number]

export interface Ecoute {
  position: Vec
  /** Vers où regarde le visiteur, et son haut : l'orientation de l'auditeur. */
  avant: Vec
  haut: Vec
  lieu: Lieu
  /** `ciel.jour` : 1 en plein jour, 0 la nuit. */
  jour: number
  /** Bavette, s'il est au même étage. */
  bavette: Vec | null
  /** La pluie qui tombe, 0..1 (`meteo.pluie`). */
  pluie: number
}

export class Moteur {
  readonly ctx: AudioContext
  private readonly maitre: GainNode
  private readonly pasBus: GainNode
  private readonly envoiNef: GainNode
  private readonly envoiGalerie: GainNode
  private readonly nef: GainNode
  private readonly dehors: GainNode
  private readonly jour: GainNode
  private readonly nuit: GainNode
  private readonly ronronneur: { panner: PannerNode; gain: GainNode }
  private readonly averse: { filtre: BiquadFilterNode; gain: GainNode }
  private readonly horloge: PannerNode
  private readonly tableau: PannerNode
  private readonly erables: PlantPlacement[]
  private readonly sources: AudioScheduledSourceNode[] = []
  private prochainTic = 0
  private tac = false
  private prochainChant = 0
  private position: Vec = [0, 0, 0]
  private readonly cibles = new Map<AudioParam, number>()

  constructor(ctx: AudioContext, erables: PlantPlacement[]) {
    this.ctx = ctx
    this.erables = erables
    const g = (valeur: number, vers: AudioNode) => {
      const n = ctx.createGain()
      n.gain.value = valeur
      n.connect(vers)
      return n
    }
    // Un limiteur doux en bout de chaîne : un carillon sur le tableau qui tourne ne sature jamais.
    const limiteur = ctx.createDynamicsCompressor()
    limiteur.threshold.value = -12
    limiteur.knee.value = 6
    limiteur.ratio.value = 12
    limiteur.attack.value = 0.003
    limiteur.release.value = 0.25
    limiteur.connect(ctx.destination)
    this.maitre = g(0.6, limiteur)

    const salleNef = salle(ctx, 3.6)
    const salleGalerie = salle(ctx, 0.8)
    salleNef.connect(this.maitre)
    salleGalerie.connect(this.maitre)

    this.pasBus = g(0.8, this.maitre)
    this.envoiNef = g(0, salleNef)
    this.envoiGalerie = g(0, salleGalerie)
    this.pasBus.connect(this.envoiNef)
    this.pasBus.connect(this.envoiGalerie)

    // Ce qui sonne dans la nef y réverbère toujours, qu'on l'écoute de près ou de loin.
    this.nef = g(0, this.maitre)
    this.nef.connect(g(0.55, salleNef))
    this.horloge = this.panner(HORLOGE, this.nef, 6)
    this.tableau = this.panner(TABLEAU, this.nef, 5)

    this.dehors = g(0, this.maitre)
    this.jour = g(0, this.dehors)
    this.nuit = g(0, this.dehors)
    this.sources.push(vent(ctx, g(0.18, this.dehors)))
    this.sources.push(grillons(ctx, g(0.5, this.nuit)))
    // Le ruisseau en quatre points le long de son tracé, et la cascade à la lèvre de l'étang.
    const eauBus = g(0.9, this.dehors)
    for (let i = 1; i <= 4; i++) {
      const [x, z] = TRACE_RUISSEAU[Math.round((i / 5) * (TRACE_RUISSEAU.length - 1))]
      this.sources.push(eau(ctx, this.panner([x, 0.2, z], eauBus, 2.5, 'equalpower'), false, i * 1.3))
    }
    this.sources.push(eau(ctx, this.panner([LEVRE[0], 0.3, LEVRE[1]], g(1.4, eauBus), 3, 'equalpower'), true))

    const gainRonron = g(0, this.maitre)
    this.ronronneur = { panner: this.panner([0, -100, 0], gainRonron, 0.4), gain: gainRonron }
    this.sources.push(ronron(ctx, this.ronronneur.panner))

    const filtre = ctx.createBiquadFilter()
    filtre.type = 'lowpass'
    this.averse = { filtre, gain: g(0, this.maitre) }
    filtre.connect(this.averse.gain)
    this.sources.push(pluie(ctx, filtre))
  }

  /** Une source placée : distance inverse, HRTF (ou panoramique simple pour les nappes). */
  private panner([x, y, z]: Vec, vers: AudioNode, reference: number, modele: PanningModelType = 'HRTF'): PannerNode {
    const p = this.ctx.createPanner()
    p.panningModel = modele
    p.distanceModel = 'inverse'
    p.refDistance = reference
    p.rolloffFactor = 1.2
    p.maxDistance = 200
    p.positionX.value = x
    p.positionY.value = y
    p.positionZ.value = z
    p.connect(vers)
    return p
  }

  /** À chaque image : l'oreille suit la caméra, le mélange suit le lieu, l'horloge bat. */
  maj(e: Ecoute) {
    const { ctx } = this
    const t = ctx.currentTime
    const m = mixage(e.lieu)
    this.position = e.position
    // Seulement quand la cible change : au cinquantième près ; un événement par image encombrerait la file du paramètre.
    const vers = (p: AudioParam, cible: number) => {
      const v = Math.round(cible * 50) / 50
      if (this.cibles.get(p) === v) return
      this.cibles.set(p, v)
      p.setTargetAtTime(v, t, FONDU)
    }
    vers(this.nef.gain, m.sourcesNef)
    vers(this.envoiNef.gain, m.reverbNef)
    vers(this.envoiGalerie.gain, m.reverbGalerie)
    vers(this.dehors.gain, m.dehors)
    vers(this.jour.gain, e.jour)
    vers(this.nuit.gain, 1 - e.jour)

    const l = ctx.listener
    const [[x, y, z], [ax, ay, az], [hx, hy, hz]] = [e.position, e.avant, e.haut]
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z
      l.forwardX.value = ax; l.forwardY.value = ay; l.forwardZ.value = az
      l.upX.value = hx; l.upY.value = hy; l.upZ.value = hz
    } else {
      // Firefox : l'ancienne interface.
      l.setPosition(x, y, z)
      l.setOrientation(ax, ay, az, hx, hy, hz)
    }

    // Bavette ronronne pour qui s'approche.
    const b = e.bavette
    const d = b ? Math.hypot(b[0] - x, b[2] - z) : Infinity
    if (b) {
      const p = this.ronronneur.panner
      p.positionX.value = b[0]; p.positionY.value = b[1]; p.positionZ.value = b[2]
    }
    vers(this.ronronneur.gain.gain, 0.9 * volumeRonron(d))

    // La pluie, étouffée par la verrière ou les murs.
    const p = pluieEntendue(e.lieu, e.pluie)
    vers(this.averse.gain.gain, 0.5 * p.gain)
    vers(this.averse.filtre.frequency, p.coupure)

    // Le tic-tac, programmé un peu d'avance ; recalé après une suspension.
    if (this.prochainTic < t) this.prochainTic = t + 0.05
    while (this.prochainTic < t + 0.2) {
      tic(ctx, this.horloge, this.prochainTic, (this.tac = !this.tac), 0.55)
      this.prochainTic += 1
    }

    // Un chant de temps en temps, le jour, pour qui est dehors.
    if (t >= this.prochainChant) {
      this.prochainChant = t + 1.2 + Math.random() * 4
      if (m.dehors > 0.5 && e.jour > 0.2) this.chanter(e.jour)
    }
  }

  private chanter(jour: number) {
    const [x, , z] = this.position
    const proches = this.erables.filter((a) => Math.hypot(a.x - x, a.z - z) < PORTEE_OISEAUX)
    const arbre = proches[Math.floor(Math.random() * proches.length)]
    if (!arbre) return
    const p = this.panner([arbre.x, (arbre.y ?? 0) + 4 + Math.random() * 2, arbre.z], this.jour, 6)
    oiseau(this.ctx, p, this.ctx.currentTime + 0.05, 0.9 * jour)
    // Le panner est lâché au bout du chant : plus rien ne le référence.
    setTimeout(() => p.disconnect(), 5000)
  }

  /** Un pas sur ce sol. */
  /** Le volume général du réglage, de 0 à 1 : 0,6 à fond, la marge du limiteur. */
  volume(v: number) {
    this.maitre.gain.setTargetAtTime(0.6 * v, this.ctx.currentTime, 0.05)
  }

  pas(matiere: Matiere, force = 1) {
    pas(this.ctx, this.pasBus, this.ctx.currentTime + 0.01, matiere, force)
  }

  /** Les palettes du tableau qui tournent pendant `duree` secondes. */
  volets(duree: number) {
    volets(this.ctx, this.tableau, this.ctx.currentTime + 0.02, duree, 0.8)
  }

  /** Un carillon : ses cloches, frappées depuis l'horloge. */
  carillon(partition: Coup[]) {
    const t = this.ctx.currentTime + 0.1
    for (const c of partition) cloche(this.ctx, this.horloge, t + c.t, c.frequence, c.bourdon ? 1.1 : 0.75, c.bourdon ? 7 : 4.5)
  }

  fermer() {
    for (const s of this.sources) s.stop()
    return this.ctx.close()
  }
}
