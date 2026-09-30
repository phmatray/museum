/**
 * Les VOIX de l'ambiance, toutes synthétisées : aucun fichier à télécharger,
 * aucune licence à citer. Chaque fonction joue un son dans `out` à l'instant `t`
 * d'un `BaseAudioContext` — le vrai en jeu, ou un `OfflineAudioContext` pour
 * vérifier hors ligne, dans un Chromium piloté, qu'aucun ne sature ni ne se tait.
 *
 * Deux façons de faire, selon le son :
 * - les sons BREFS (pas, tic-tac, cloches) sont de petits graphes éphémères —
 *   un bruit filtré ou quelques sinus sous une enveloppe — qui se détruisent seuls ;
 * - les TEXTURES (eau, vent, grillons, ronron, volets, gravier) sont calculées
 *   une fois en JS dans un tampon, bouclé sans couture, et rejouées.
 */
import type { Matiere } from '../domain/son'

const alea = Math.random
const entre = (a: number, b: number) => a + alea() * (b - a)

// ── Les tampons calculés ──────────────────────────────────────────────────

const caches = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>()

/**
 * Un tampon calculé une fois par contexte. `boucle` : `secondes` plus un fondu
 * de 0,25 s, dont la fin est repliée sur le début à puissance constante — la
 * boucle ne claque pas à la jointure.
 */
function tampon(ctx: BaseAudioContext, cle: string, secondes: number, canaux: number, remplir: (d: Float32Array, canal: number, sr: number) => void, boucle = false): AudioBuffer {
  let cache = caches.get(ctx)
  if (!cache) caches.set(ctx, (cache = new Map()))
  const deja = cache.get(cle)
  if (deja) return deja
  const sr = ctx.sampleRate
  const n = Math.round(secondes * sr)
  const f = boucle ? Math.round(0.25 * sr) : 0
  const b = ctx.createBuffer(canaux, n, sr)
  for (let c = 0; c < canaux; c++) {
    const d = new Float32Array(n + f)
    remplir(d, c, sr)
    for (let i = 0; i < f; i++) {
      const w = i / f
      d[i] = d[i] * Math.sqrt(w) + d[n + i] * Math.sqrt(1 - w)
    }
    b.copyToChannel(d.subarray(0, n), c)
  }
  cache.set(cle, b)
  return b
}

/** Deux secondes de bruit blanc : la matière première des impacts. */
const bruit = (ctx: BaseAudioContext) => tampon(ctx, 'bruit', 2, 1, (d) => { for (let i = 0; i < d.length; i++) d[i] = alea() * 2 - 1 })

/**
 * Une réponse impulsionnelle de salle : du bruit stéréo qui décroît de 60 dB en
 * `duree` secondes, et s'assombrit en chemin (un passe-bas à un pôle qui se
 * referme) — les aigus meurent avant les graves, comme dans la pierre.
 */
export function reponseDeSalle(ctx: BaseAudioContext, duree: number): AudioBuffer {
  return tampon(ctx, `salle:${duree}`, duree, 2, (d, _c, sr) => {
    const predelai = Math.round(0.018 * sr)
    let y = 0
    for (let i = predelai; i < d.length; i++) {
      const t = (i - predelai) / sr
      const a = 0.85 - 0.7 * Math.min(1, t / duree)
      y += a * ((alea() * 2 - 1) - y)
      d[i] = y * Math.exp((-6.9 * t) / duree)
    }
  })
}

/** Une salle toute faite : un convolueur chargé de sa réponse. */
export function salle(ctx: BaseAudioContext, duree: number): ConvolverNode {
  const c = ctx.createConvolver()
  c.buffer = reponseDeSalle(ctx, duree)
  return c
}

// ── Les briques des sons brefs ────────────────────────────────────────────

/** Une enveloppe percussive : attaque de 2 ms, chute exponentielle en `duree`. */
function enveloppe(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, duree: number, attaque = 0.002): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + attaque)
  g.gain.exponentialRampToValueAtTime(1e-4, t + attaque + duree)
  g.connect(out)
  return g
}

/** Un coup de bruit filtré : le claquement, le frottement, le choc. */
function impact(ctx: BaseAudioContext, out: AudioNode, t: number, type: BiquadFilterType, frequence: number, q: number, duree: number, gain: number) {
  const s = ctx.createBufferSource()
  s.buffer = bruit(ctx)
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequence
  f.Q.value = q
  s.connect(f).connect(enveloppe(ctx, out, t, gain, duree))
  s.start(t, alea() * 1.5)
  s.stop(t + duree + 0.05)
}

/** Une résonance brève : le corps d'un plancher, d'une caisse de bois. */
function corps(ctx: BaseAudioContext, out: AudioNode, t: number, frequence: number, duree: number, gain: number) {
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(frequence * 1.15, t)
  o.frequency.exponentialRampToValueAtTime(frequence, t + 0.02)
  o.connect(enveloppe(ctx, out, t, gain, duree))
  o.start(t)
  o.stop(t + duree + 0.05)
}

/** Une tranche d'une texture calculée, sous enveloppe : le crissement d'un pas. */
function tranche(ctx: BaseAudioContext, out: AudioNode, t: number, b: AudioBuffer, duree: number, gain: number, vitesse = 1, filtre?: [BiquadFilterType, number]) {
  const s = ctx.createBufferSource()
  s.buffer = b
  s.playbackRate.value = vitesse
  const g = enveloppe(ctx, out, t, gain, duree, 0.012)
  if (filtre) {
    const f = ctx.createBiquadFilter()
    ;[f.type, f.frequency.value] = filtre
    s.connect(f).connect(g)
  } else s.connect(g)
  s.start(t, alea() * (b.duration - duree - 0.1))
  s.stop(t + duree + 0.1)
}

// ── Les pas ───────────────────────────────────────────────────────────────

/**
 * Le gravier : des grains, des milliers de petits cailloux qui roulent — des
 * impulsions brèves, serrées, aux amplitudes au hasard, passées dans un
 * passe-haut. On en rejoue une tranche à chaque pas.
 */
const gravier = (ctx: BaseAudioContext) => tampon(ctx, 'gravier', 3, 1, (d, _c, sr) => {
  let grain = 0
  let a = 0
  let hp = 0
  let prec = 0
  for (let i = 0; i < d.length; i++) {
    if (alea() < 1800 / sr) { a = entre(0.2, 1) ** 2; grain = Math.round(entre(0.0006, 0.004) * sr) }
    const x = grain-- > 0 ? (alea() * 2 - 1) * a : 0
    hp = 0.8 * (hp + x - prec) // passe-haut : le crissement, pas le grondement
    prec = x
    d[i] = hp * 0.8
  }
})

/**
 * Un pas, au timbre de son sol. Talon puis pointe, 50 à 70 ms plus tard ; une
 * variation de hauteur et de force à chaque pas, sans quoi l'oreille entend la
 * boucle au troisième.
 */
export function pas(ctx: BaseAudioContext, out: AudioNode, t: number, matiere: Matiere, force = 1) {
  const v = entre(0.9, 1.1)
  const g = force * entre(0.8, 1)
  const pointe = t + entre(0.05, 0.075)
  switch (matiere) {
    case 'pierre':
      // Le terrazzo : un claquement sec de semelle, un soupçon de choc sourd.
      impact(ctx, out, t, 'bandpass', 2600 * v, 1.1, 0.035, 0.55 * g)
      impact(ctx, out, pointe, 'bandpass', 3400 * v, 1.4, 0.02, 0.22 * g)
      corps(ctx, out, t, 95 * v, 0.05, 0.22 * g)
      break
    case 'parquet':
      // Plus mat, plus boisé : le plancher résonne un peu, et craque parfois.
      impact(ctx, out, t, 'bandpass', 950 * v, 0.9, 0.055, 0.45 * g)
      impact(ctx, out, pointe, 'bandpass', 1400 * v, 1, 0.035, 0.18 * g)
      corps(ctx, out, t, 150 * v, 0.09, 0.3 * g)
      if (alea() < 0.1) craquement(ctx, out, t + 0.03, 0.1 * g)
      break
    case 'bois':
      // Le tablier du pont : creux, une caisse de résonance sur l'eau.
      impact(ctx, out, t, 'bandpass', 520 * v, 2, 0.08, 0.5 * g)
      corps(ctx, out, t, 115 * v, 0.16, 0.45 * g)
      corps(ctx, out, t, 235 * v, 0.07, 0.14 * g)
      impact(ctx, out, pointe, 'bandpass', 800 * v, 2, 0.05, 0.18 * g)
      break
    case 'gravier':
      tranche(ctx, out, t, gravier(ctx), 0.2, 0.7 * g, v, ['bandpass', 2600])
      tranche(ctx, out, pointe, gravier(ctx), 0.12, 0.4 * g, v, ['bandpass', 3400])
      break
    case 'herbe':
      // Un choc étouffé, et le froissement des brins.
      impact(ctx, out, t, 'lowpass', 320 * v, 0.7, 0.09, 0.6 * g)
      tranche(ctx, out, t + 0.01, gravier(ctx), 0.18, 0.1 * g, 0.7 * v, ['highpass', 4200])
      break
  }
}

/**
 * Le hérisson dans l'herbe : un frôlement de brins (du bruit adouci, attaque
 * lente) et, une fois sur deux, le crépitement d'une feuille sèche (une
 * tranche du gravier, plus haut, plus bref). `force` porte déjà la distance.
 */
export function froissement(ctx: BaseAudioContext, out: AudioNode, t: number, force: number) {
  const v = entre(0.85, 1.2)
  const s = ctx.createBufferSource()
  s.buffer = bruit(ctx)
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = 3200 * v
  f.Q.value = 0.6
  const duree = entre(0.07, 0.16)
  s.connect(f).connect(enveloppe(ctx, out, t, 0.22 * force * entre(0.6, 1), duree, 0.02))
  s.start(t, alea() * 1.5)
  s.stop(t + duree + 0.08)
  if (alea() < 0.5) tranche(ctx, out, t + entre(0, 0.04), gravier(ctx), entre(0.04, 0.08), 0.12 * force, 1.6 * v, ['highpass', 3000])
}

/** Le craquement d'une latte : un grincement bref, une plainte qui descend. */
function craquement(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number) {
  const o = ctx.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(entre(420, 600), t)
  o.frequency.exponentialRampToValueAtTime(entre(250, 330), t + 0.14)
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = 1200
  f.Q.value = 3
  o.connect(f).connect(enveloppe(ctx, out, t, gain, 0.16, 0.03))
  o.start(t)
  o.stop(t + 0.25)
}

// ── L'horloge ─────────────────────────────────────────────────────────────

/** Le tic-tac d'un grand mouvement : un échappement sec, un « tac » plus grave. */
export function tic(ctx: BaseAudioContext, out: AudioNode, t: number, tac: boolean, force = 1) {
  impact(ctx, out, t, 'bandpass', tac ? 2300 : 2900, 7, 0.022, 0.9 * force)
  corps(ctx, out, t, tac ? 1250 : 1580, 0.025, 0.12 * force)
  corps(ctx, out, t, 420, 0.06, 0.12 * force)
}

/**
 * Les partiels d'une cloche d'église, en rapports de la note frappée : le hum
 * à l'octave grave, la tierce mineure qui fait « cloche », la quinte, le
 * nominal — chacun avec sa force et sa tenue (les graves tiennent le plus).
 */
const PARTIELS: [number, number, number][] = [
  [0.5, 0.55, 1], [1, 0.8, 0.75], [1.19, 0.4, 0.55], [1.5, 0.25, 0.45],
  [2, 0.45, 0.35], [2.51, 0.14, 0.22], [2.99, 0.1, 0.18], [4.07, 0.06, 0.12],
]

/** Une cloche frappée en `t` : `duree` est la tenue du hum. */
export function cloche(ctx: BaseAudioContext, out: AudioNode, t: number, frequence: number, force = 1, duree = 5) {
  const somme = ctx.createGain()
  somme.gain.value = 0.16 * force
  somme.connect(out)
  for (const [r, g, tenue] of PARTIELS) {
    // Deux sinus à peine désaccordés : le battement lent d'une vraie cloche.
    for (const dec of [0.9985, 1.0015]) {
      const o = ctx.createOscillator()
      o.frequency.value = frequence * r * dec
      o.connect(enveloppe(ctx, somme, t, g / 2, duree * tenue, 0.003))
      o.start(t)
      o.stop(t + duree * tenue + 0.1)
    }
  }
  // Le battant : un bref choc métallique.
  impact(ctx, somme, t, 'bandpass', frequence * 5, 3, 0.03, 0.5)
}

// ── Le tableau des départs ────────────────────────────────────────────────

/**
 * Le cliquetis des palettes : des centaines de petits claquements de plastique
 * par seconde, qui montent pendant que les colonnes démarrent l'une après
 * l'autre, puis s'éteignent quand elles atteignent leur lettre. Calculé pour la
 * durée d'une page (`dureeVolets`).
 */
export function volets(ctx: BaseAudioContext, out: AudioNode, t: number, duree: number, force = 1) {
  const s = ctx.createBufferSource()
  s.buffer = tampon(ctx, `volets:${duree.toFixed(2)}`, duree + 0.1, 1, (d, _c, sr) => {
    const clic = (f: number) => {
      const n = Math.round(0.006 * sr)
      return Float32Array.from({ length: n }, (_, i) => {
        const u = i / sr
        return (Math.sin(2 * Math.PI * f * u) * 0.7 + (alea() * 2 - 1) * 0.5) * Math.exp(-u / 0.0012)
      })
    }
    const modeles = [3100, 3700, 4300, 5200, 2600].map(clic)
    for (let i = 0; i < d.length; i++) {
      const u = i / sr / duree
      const densite = 380 * Math.min(1, u / 0.3) * Math.max(0, 1 - u) ** 1.4
      if (alea() >= densite / sr) continue
      const m = modeles[Math.floor(alea() * modeles.length)]
      const a = entre(0.15, 0.5)
      for (let k = 0; k < m.length && i + k < d.length; k++) d[i + k] += m[k] * a
    }
  })
  const g = ctx.createGain()
  g.gain.value = force
  s.connect(g).connect(out)
  s.start(t)
}

// ── Le jardin ─────────────────────────────────────────────────────────────

/**
 * Un oiseau qui chante : trois « espèces » de synthèse, un sinus qui glisse.
 * La mésange (deux notes répétées, « ti-tu »), le merle (des sifflets graves
 * et ronds) et la fauvette (une trille rapide).
 */
export function oiseau(ctx: BaseAudioContext, out: AudioNode, t: number, force = 1) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  g.gain.value = 0
  o.connect(g).connect(out)
  const note = (debut: number, duree: number, de: number, a: number, gain: number) => {
    o.frequency.setValueAtTime(de, debut)
    o.frequency.exponentialRampToValueAtTime(a, debut + duree)
    g.gain.setValueAtTime(0, debut)
    g.gain.linearRampToValueAtTime(gain * force, debut + duree * 0.2)
    g.gain.linearRampToValueAtTime(0, debut + duree)
  }
  let u = t
  const espece = alea()
  if (espece < 0.4) {
    const [haut, bas] = [entre(4800, 5600), entre(3600, 4200)]
    for (let i = 0, n = 2 + Math.floor(alea() * 3); i < n; i++) {
      note(u, 0.09, haut, haut * 1.04, 0.1); u += 0.13
      note(u, 0.12, bas, bas * 0.97, 0.08); u += 0.2
    }
  } else if (espece < 0.75) {
    for (let i = 0, n = 3 + Math.floor(alea() * 4); i < n; i++) {
      const f = entre(1600, 2800)
      note(u, entre(0.12, 0.28), f, f * entre(0.8, 1.3), 0.12); u += entre(0.18, 0.36)
    }
  } else {
    const f = entre(3800, 5000)
    for (let i = 0; i < 14; i++) { note(u, 0.045, f * 1.25, f, 0.07 * (1 - i / 20)); u += 0.055 }
  }
  o.start(t)
  o.stop(u + 0.1)
}

/** Une boucle calculée, jouée sans fin. */
function boucle(ctx: BaseAudioContext, out: AudioNode, b: AudioBuffer, depuis = 0): AudioBufferSourceNode {
  const s = ctx.createBufferSource()
  s.buffer = b
  s.loop = true
  s.connect(out)
  s.start(ctx.currentTime, depuis % b.duration)
  return s
}

/**
 * L'eau vive : un bruit rose grave (le flot) et des bulles — de brefs sinus
 * qui montent, comme l'air qui crève à la surface. `cascade` : plus de débit,
 * plus d'aigu, moins de bulles distinctes.
 */
export function eau(ctx: BaseAudioContext, out: AudioNode, cascade: boolean, depuis = 0) {
  const b = tampon(ctx, cascade ? 'cascade' : 'ruisseau', 5, 1, (d, _c, sr) => {
    let [b0, b1, b2, lp] = [0, 0, 0, 0]
    const coupure = cascade ? 0.35 : 0.12
    for (let i = 0; i < d.length; i++) {
      // Bruit rose (Kellet, allégé) puis un passe-bas : le chuintement du flot.
      const w = alea() * 2 - 1
      b0 = 0.99765 * b0 + w * 0.099
      b1 = 0.963 * b1 + w * 0.2965
      b2 = 0.57 * b2 + w * 1.0527
      lp += coupure * ((b0 + b1 + b2 + w * 0.1848) * 0.2 - lp)
      d[i] += lp * (cascade ? 0.32 : 0.24)
    }
    const bulles = cascade ? 25 : 14
    for (let n = 0; n < bulles * 5; n++) {
      const i0 = Math.floor(alea() * d.length)
      const [f0, dur, a] = [entre(350, 1100), entre(0.012, 0.035), entre(0.05, 0.16)]
      let phase = 0
      for (let k = 0; k < dur * sr && i0 + k < d.length; k++) {
        const u = k / sr
        phase += (2 * Math.PI * f0 * (1 + (u / dur) * 0.9)) / sr
        d[i0 + k] += Math.sin(phase) * a * Math.sin((Math.PI * u) / dur)
      }
    }
  }, true)
  return boucle(ctx, out, b, depuis)
}

/** Le vent : un bruit brun, doux, que le moteur fait respirer par un filtre lent. */
export function vent(ctx: BaseAudioContext, out: AudioNode) {
  const b = tampon(ctx, 'vent', 6, 2, (d) => {
    let [y, prec, hp] = [0, 0, 0]
    for (let i = 0; i < d.length; i++) {
      y = (y + 0.02 * (alea() * 2 - 1)) * 0.998
      hp = y - prec + 0.995 * hp // sans composante continue : elle mangerait la marge du limiteur
      prec = y
      d[i] = hp * 1.2
    }
  }, true)
  const f = ctx.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = 500
  f.Q.value = 0.5
  // Les rafales : une oscillation très lente de la coupure.
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.07
  const ampleur = ctx.createGain()
  ampleur.gain.value = 280
  lfo.connect(ampleur).connect(f.frequency)
  lfo.start()
  f.connect(out)
  return boucle(ctx, f, b)
}

/**
 * Les grillons d'une nuit d'été : trois ou quatre bêtes, chacune sa hauteur
 * (4,2 à 5 kHz), son rythme de stridulation (trois ou quatre coups à ~30 Hz,
 * toutes les 0,5 à 0,8 s) et sa place dans le champ stéréo.
 */
export function grillons(ctx: BaseAudioContext, out: AudioNode) {
  const b = tampon(ctx, 'grillons', 8, 2, (d, canal, sr) => {
    for (let n = 0; n < 4; n++) {
      const [f, periode, coups, pan] = [entre(4200, 5000), entre(0.5, 0.8), 3 + (n % 2), n / 3]
      const gain = 0.12 * (canal === 0 ? 1 - pan : pan) + 0.03
      const decalage = alea() * periode
      for (let i = 0; i < d.length; i++) {
        const u = (i / sr + decalage) % periode
        const k = u * 30
        if (k >= coups) continue
        d[i] += Math.sin((2 * Math.PI * f * i) / sr) * Math.sin(Math.PI * (k % 1)) * gain
      }
    }
  }, true)
  return boucle(ctx, out, b, alea() * 8)
}

/**
 * Le ronron de Bavette : une vingtaine de battements de larynx par seconde, un
 * bruit sourd pulsé, l'inspiration un peu plus haute et plus faible que
 * l'expiration, une respiration toutes les deux secondes.
 */
export function ronron(ctx: BaseAudioContext, out: AudioNode) {
  const b = tampon(ctx, 'ronron', 4, 1, (d, _c, sr) => {
    let lp = 0
    let phase = 0
    for (let i = 0; i < d.length; i++) {
      const u = (i / sr) % 2
      const inspire = u < 0.8
      const souffle = Math.sin((Math.PI * (inspire ? u : u - 0.8)) / (inspire ? 0.8 : 1.2)) ** 0.6
      phase += (inspire ? 27 : 23) / sr
      const battement = Math.max(0, Math.sin(2 * Math.PI * phase)) ** 3
      lp += 0.06 * ((alea() * 2 - 1) - lp)
      d[i] = lp * battement * souffle * (inspire ? 1.6 : 2.4)
    }
  }, true)
  return boucle(ctx, out, b)
}

/**
 * La pluie : un chuintement de bruit blanc adouci, semé de milliers de gouttes
 * — de brefs clics filtrés, chacun sa hauteur. Le moteur l'étouffe selon le lieu.
 */
export function pluie(ctx: BaseAudioContext, out: AudioNode) {
  const b = tampon(ctx, 'pluie', 4, 2, (d, _c, sr) => {
    let lp = 0
    for (let i = 0; i < d.length; i++) {
      lp += 0.35 * ((alea() * 2 - 1) - lp)
      d[i] = lp * 0.12
    }
    for (let n = 0; n < 4 * 260; n++) {
      const i0 = Math.floor(alea() * d.length)
      const [f0, dur, a] = [entre(1500, 6000), entre(0.002, 0.008), entre(0.03, 0.12)]
      for (let k = 0; k < dur * sr && i0 + k < d.length; k++) d[i0 + k] += Math.sin((2 * Math.PI * f0 * k) / sr) * a * (1 - k / (dur * sr))
    }
  }, true)
  return boucle(ctx, out, b, alea() * 4)
}
