/**
 * La baraque du CHANTIER DU MUSÉE (`plan/chantier.ts`) : la charpente, le
 * lambris et la verrière de `assets/architecture/chantier.glb`
 * (`tools/blender/build-chantier.py`), et le journal de chantier accroché
 * dedans, une étape par cadre.
 *
 * ── Les cadres ──
 *
 * Deux atlas peints dans un canevas, un par taille : chaque case est le
 * passe-partout d'une étape — sa première image (avant/après), son numéro dans
 * la couleur de sa catégorie, son titre. Tous les petits cadres sont UN
 * maillage (moulures sombres) plus UN plan texturé ; les grands de même, dorés.
 * Quatre appels de dessin pour tout le journal.
 *
 * ── Paresseux ──
 *
 * Les images du journal (`journal/img/`, 12 Mo) ne se téléchargent qu'à
 * l'approche de la baraque, une fois, réduites à la taille de leur case au
 * décodage (`createImageBitmap`) : l'atlas des petits pèse 16 Mo en mémoire
 * graphique, celui des grands 13 Mo, quel que soit le nombre d'étapes. Avant,
 * les passe-partout portent déjà numéros et titres.
 *
 * ── La carte ──
 *
 * Le cadre visé (`cadreVise`, le regard entier : la frise a deux rangs) est
 * publié dans `gameStore.etape`, comme `EveilLayer` publie la toile : la carte
 * d'étape s'ouvre (`components/CarteEtape.tsx`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { EtapeJournal, Journal } from '../domain/journal'
import { adresseJournal, teinteCategorie, useJournal } from '../hooks/useChantier'
import { accrocherChantier, cadreVise, CENTRE_CHANTIER, dansLeChantier, type CadreChantier } from '../plan/chantier'
import { useGameStore } from '../stores/gameStore'
import { chargerGlb } from './propAssets'

/** À 35 m, on commence à charger les images : la baraque se voit déjà nettement. */
const APPROCHE = 35
/** Côté d'atlas visé, en pixels ; les grands cadres ont des cases de 768 px, trois par rang. */
const ATLAS = 2048
const CASE_GRANDE = 768
/** La moulure : sa largeur (petit, grand) et sa saillie sur le lambris. */
const MOULURE = { petit: 0.022, grand: 0.07, saillie: 0.035 }
const CREME = '#efe7d6'
const ENCRE = '#2a2520'
const SERIF = 'PT Serif Chantier'
const SANS = 'PT Sans Chantier'

export function ChantierLayer() {
  const [modele, setModele] = useState<THREE.Object3D | null>(null)
  useEffect(() => {
    let vivant = true
    chargerGlb(`${import.meta.env.BASE_URL}assets/architecture/chantier.glb`)
      .then(({ scene }) => {
        scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          const m = o.material as THREE.MeshStandardMaterial
          // Le verre ne masque rien derrière lui (comme la verrière de la nef).
          if (m.transparent) m.depthWrite = false
        })
        if (vivant) setModele(scene)
      })
      .catch((erreur: unknown) => console.error('baraque du chantier indisponible', erreur))
    return () => {
      vivant = false
    }
  }, [])
  // La baladeuse brûle plus fort la nuit.
  const jour = useGameStore((s) => s.ciel.jour)
  useEffect(() => {
    const ampoule = modele?.getObjectByName('Chantier_Ampoule') as THREE.Mesh | undefined
    if (ampoule) (ampoule.material as THREE.MeshStandardMaterial).emissiveIntensity = 4 + 8 * (1 - jour)
  }, [modele, jour])

  const journal = useJournal()
  return (
    <group name="chantier">
      {modele && <primitive object={modele} />}
      {journal && journal.etapes.length > 0 && <Cadres journal={journal} jour={jour} />}
    </group>
  )
}

// ── Les cadres ──────────────────────────────────────────────────────────────

function atlasDe(n: number, grand: boolean): { cols: number; cote: number; l: number; h: number } {
  const cols = grand ? Math.min(3, Math.max(1, n)) : Math.max(1, Math.ceil(Math.sqrt(n)))
  const cote = grand ? CASE_GRANDE : Math.floor(ATLAS / cols)
  return { cols, cote, l: cols * cote, h: Math.ceil(n / cols) * cote }
}

/** Le quad d'une case, posé dans le plan du cadre, ses UV sur la case `k` de l'atlas. */
function quad(c: CadreChantier, m: number, k: number, a: { cols: number; cote: number; l: number; h: number }): THREE.BufferGeometry {
  const [nx, nz] = c.normal
  // Face au mur, la droite du visiteur : (−n) × y.
  const [rx, rz] = [nz, -nx]
  const d = c.cote / 2 - m
  const [x, y, z] = [c.x + nx * 0.004, c.y, c.z + nz * 0.004]
  const p = [[-d, -d], [d, -d], [d, d], [-d, d]].flatMap(([u, v]) => [x + rx * u, y + v, z + rz * u])
  const [cx, cy] = [(k % a.cols) * a.cote, Math.floor(k / a.cols) * a.cote]
  const [u0, u1, v0, v1] = [cx / a.l, (cx + a.cote) / a.l, 1 - (cy + a.cote) / a.h, 1 - cy / a.h]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

/** Les quatre baguettes de la moulure d'un cadre. */
function moulure(c: CadreChantier, m: number): THREE.BufferGeometry[] {
  const [nx, nz] = c.normal
  const [rx, rz] = [nz, -nx]
  const s = MOULURE.saillie
  // Le cadre part du lambris (2 cm derrière le plan de la case) et saille de `s`.
  const [x, z] = [c.x + nx * (s / 2 - 0.02), c.z + nz * (s / 2 - 0.02)]
  const h = c.cote / 2
  return [[0, h - m / 2, c.cote, m], [0, -h + m / 2, c.cote, m], [-h + m / 2, 0, m, c.cote - 2 * m], [h - m / 2, 0, m, c.cote - 2 * m]].map(([u, v, l, t]) => {
    const g = new THREE.BoxGeometry(Math.abs(rx) * l + Math.abs(nx) * s, t, Math.abs(rz) * l + Math.abs(nz) * s)
    g.translate(x + rx * u, c.y + v, z + rz * u)
    return g
  })
}

/** Un canevas crème de 4 px : la carte des cases tant que l'atlas n'est pas peint (la matière garde sa `map`, pas de recompilation). */
function attente(): THREE.Texture {
  const t = new THREE.DataTexture(new Uint8Array(16).fill(0).map((_, i) => (i % 4 === 3 ? 255 : [239, 231, 214][i % 4])), 2, 2)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

function Cadres({ journal, jour }: { journal: Journal; jour: number }) {
  const cadres = useMemo(() => accrocherChantier(journal.etapes.length), [journal])
  const formats = useMemo(() => {
    const petits = cadres.filter((c) => !c.grand).length
    return { petits: atlasDe(petits, false), grands: atlasDe(cadres.length - petits, true) }
  }, [cadres])
  const geometries = useMemo(() => {
    const [p, g] = [cadres.filter((c) => !c.grand), cadres.filter((c) => c.grand)]
    const fondre = (gs: THREE.BufferGeometry[]) => {
      const f = gs.length ? mergeGeometries(gs) : null
      gs.forEach((x) => x.dispose())
      return f
    }
    return {
      casesPetites: fondre(p.map((c) => quad(c, MOULURE.petit, c.case, formats.petits))),
      casesGrandes: fondre(g.map((c) => quad(c, MOULURE.grand, c.case, formats.grands))),
      mouluresPetites: fondre(p.flatMap((c) => moulure(c, MOULURE.petit))),
      mouluresGrandes: fondre(g.flatMap((c) => moulure(c, MOULURE.grand))),
    }
  }, [cadres, formats])
  useEffect(() => () => Object.values(geometries).forEach((g) => g?.dispose()), [geometries])

  const matieres = useMemo(() => {
    // La même carte en `map` et en `emissiveMap` dès le départ : l'atlas la remplace sans changer de programme.
    const image = () => {
      const t = attente()
      return new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0, roughness: 0.82 })
    }
    return {
      petites: image(),
      grandes: image(),
      // Le chêne fumé des petits cadres, le bronze doré des grands.
      chene: new THREE.MeshStandardMaterial({ color: '#2b1d14', roughness: 0.55 }),
      dore: new THREE.MeshStandardMaterial({ color: '#b98c3e', roughness: 0.35, metalness: 0.85 }),
    }
  }, [])
  useEffect(() => () => Object.values(matieres).forEach((m) => {
    m.map?.dispose()
    m.dispose()
  }), [matieres])

  // La nuit, la baladeuse éclaire les cadres : l'image luit d'elle-même, doucement.
  useEffect(() => {
    for (const m of [matieres.petites, matieres.grandes]) m.emissiveIntensity = 0.32 * (1 - jour)
  }, [matieres, jour])

  // L'approche : le visiteur à moins de `APPROCHE` m ; on peint une fois pour toutes.
  const proche = useGameStore((s) => s.visiteur !== null && s.visiteur.level === 0 && Math.hypot(s.visiteur.x - CENTRE_CHANTIER[0], s.visiteur.z - CENTRE_CHANTIER[1]) < APPROCHE)
  const peint = useRef<{ ok: boolean } | null>(null)
  useEffect(() => {
    if (!proche || peint.current) return
    peint.current = { ok: true }
    void peindre(journal, cadres, formats, matieres, peint.current)
  }, [proche, journal, cadres, formats, matieres])
  useEffect(() => () => {
    if (peint.current) peint.current.ok = false
  }, [])

  // Le cadre regardé : tous les dixièmes de seconde, et seulement près de la baraque.
  const camera = useThree((s) => s.camera)
  const suivi = useRef({ oeil: new THREE.Vector3(), dir: new THREE.Vector3(), t: 0 })
  useFrame((_, dt) => {
    const regard = suivi.current
    regard.t -= dt
    if (regard.t > 0) return
    regard.t = 0.1
    camera.getWorldPosition(regard.oeil)
    const pres = dansLeChantier(regard.oeil.x, regard.oeil.z, 1)
    const c = pres ? cadreVise(cadres, regard.oeil, camera.getWorldDirection(regard.dir)) : null
    const ancre = c ? journal.etapes[c.etape].ancre : null
    if (useGameStore.getState().etape !== ancre) useGameStore.setState({ etape: ancre })
  })
  useEffect(() => () => {
    if (useGameStore.getState().etape !== null) useGameStore.setState({ etape: null })
  }, [])

  return (
    <>
      {geometries.casesPetites && <mesh geometry={geometries.casesPetites} material={matieres.petites} />}
      {geometries.casesGrandes && <mesh geometry={geometries.casesGrandes} material={matieres.grandes} />}
      {geometries.mouluresPetites && <mesh geometry={geometries.mouluresPetites} material={matieres.chene} />}
      {geometries.mouluresGrandes && <mesh geometry={geometries.mouluresGrandes} material={matieres.dore} />}
    </>
  )
}

// ── La peinture des atlas ───────────────────────────────────────────────────

let polices: Promise<unknown> | null = null
/** Les polices des cartels du musée, chargées une fois pour le canevas. */
function chargerPolices() {
  const base = `${import.meta.env.BASE_URL}assets/fonts/`
  polices ??= Promise.all([
    new FontFace(SERIF, `url(${base}PTSerif-Regular.ttf)`).load(),
    new FontFace(SANS, `url(${base}PTSans-Regular.ttf)`).load(),
  ])
    .then((f) => f.forEach((x) => document.fonts.add(x)))
    .catch(() => undefined)
  return polices
}

/** Le texte coupé en lignes d'au plus `largeur` px, `max` lignes, la dernière terminée par « … ». */
function lignes(ctx: CanvasRenderingContext2D, texte: string, largeur: number, max: number): string[] {
  const out: string[] = []
  let ligne = ''
  for (const mot of texte.split(' ')) {
    const essai = ligne ? `${ligne} ${mot}` : mot
    if (ctx.measureText(essai).width <= largeur || !ligne) ligne = essai
    else {
      out.push(ligne)
      ligne = mot
    }
  }
  out.push(ligne)
  if (out.length <= max) return out
  const coupe = out.slice(0, max)
  while (ctx.measureText(`${coupe[max - 1]}…`).width > largeur && coupe[max - 1].includes(' ')) coupe[max - 1] = coupe[max - 1].replace(/\s+\S+$/, '')
  coupe[max - 1] += '…'
  return coupe
}

/** La case d'une étape, sans son image : le passe-partout, le numéro, le titre. Rend la boîte réservée à l'image. */
function passePartout(ctx: CanvasRenderingContext2D, e: EtapeJournal, x: number, y: number, c: number, grand: boolean, categories: Record<string, string>) {
  ctx.fillStyle = CREME
  ctx.fillRect(x, y, c, c)
  const teinte = teinteCategorie(e.categorie)
  const marge = Math.round(c * (grand ? 0.07 : 0.07))
  const img = { x: x + marge, y: y + marge, l: c - 2 * marge, h: Math.round((c - 2 * marge) * (grand ? 0.66 : 0.62)) }
  // Le fond de l'image — ou, pour une étape sans capture, une couverture : sa
  // couleur de catégorie, son numéro en grand — et son filet de catégorie dessous.
  ctx.fillStyle = '#d9cfbb'
  ctx.fillRect(img.x, img.y, img.l, img.h)
  if (e.image === null) {
    ctx.fillStyle = teinte
    ctx.globalAlpha = 0.85
    ctx.fillRect(img.x, img.y, img.l, img.h)
    ctx.globalAlpha = 1
    ctx.fillStyle = CREME
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.round(img.h * (e.n === null ? 0.5 : 0.56))}px "${SERIF}", Georgia, serif`
    ctx.fillText(e.n === null ? '§' : String(e.n), img.x + img.l / 2, img.y + img.h * 0.54)
    ctx.textAlign = 'left'
  }
  ctx.fillStyle = teinte
  ctx.fillRect(img.x, img.y + img.h + Math.round(c * 0.012), img.l, Math.max(2, Math.round(c * 0.012)))
  const haut = img.y + img.h + Math.round(c * 0.05)
  ctx.textBaseline = 'top'
  if (grand) {
    ctx.fillStyle = teinte
    ctx.font = `600 ${Math.round(c * 0.032)}px "${SANS}", sans-serif`
    const surtitre = `${e.n === null ? 'HORS SÉRIE' : `ÉTAPE ${e.n}`} · ${(categories[e.categorie] ?? e.categorie).toUpperCase()}`
    ctx.fillText(surtitre, img.x, haut)
    ctx.fillStyle = ENCRE
    ctx.font = `${Math.round(c * 0.052)}px "${SERIF}", Georgia, serif`
    lignes(ctx, e.titre, img.l, 2).forEach((l, i) => ctx.fillText(l, img.x, haut + c * 0.05 + i * c * 0.062))
    ctx.fillStyle = '#6a6056'
    ctx.font = `${Math.round(c * 0.03)}px "${SANS}", sans-serif`
    ctx.fillText(e.statut, img.x, y + c - marge - c * 0.03)
  } else {
    ctx.fillStyle = teinte
    ctx.font = `700 ${Math.round(c * 0.1)}px "${SERIF}", Georgia, serif`
    // Une étape hors série (« Correctif : … ») n'a pas de numéro : son titre prend la ligne.
    const num = e.n === null ? '' : String(e.n)
    ctx.fillText(num, img.x, haut)
    const l = num ? ctx.measureText(num).width + c * 0.04 : 0
    ctx.fillStyle = ENCRE
    ctx.font = `${Math.round(c * 0.066)}px "${SANS}", sans-serif`
    lignes(ctx, e.titre, img.l - l, 3).forEach((t, i) => ctx.fillText(t, img.x + l, haut + c * 0.012 + i * c * 0.074))
  }
  return img
}

/**
 * L'image « couvrante » : recadrée au centre pour remplir la boîte, réduite à sa
 * taille au décodage. Les dimensions déclarées par le journal (`width`/`height`)
 * ne sont que son rapport : le fichier fait 1000 px de large, pas 1280.
 */
async function image(src: string, boite: { l: number; h: number }): Promise<ImageBitmap> {
  const r = await fetch(adresseJournal(src))
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const brute = await createImageBitmap(await r.blob())
  try {
    const k = Math.max(boite.l / brute.width, boite.h / brute.height)
    const [sl, sh] = [boite.l / k, boite.h / k]
    return await createImageBitmap(brute, (brute.width - sl) / 2, (brute.height - sh) / 2, sl, sh, { resizeWidth: boite.l, resizeHeight: boite.h, resizeQuality: 'high' })
  } finally {
    brute.close()
  }
}

async function peindre(
  journal: Journal,
  cadres: CadreChantier[],
  formats: { petits: ReturnType<typeof atlasDe>; grands: ReturnType<typeof atlasDe> },
  matieres: { petites: THREE.MeshStandardMaterial; grandes: THREE.MeshStandardMaterial },
  vivant: { ok: boolean },
) {
  await chargerPolices()
  if (!vivant.ok) return
  const atlas = (f: ReturnType<typeof atlasDe>, m: THREE.MeshStandardMaterial) => {
    const canevas = document.createElement('canvas')
    canevas.width = f.l
    canevas.height = f.h
    const ctx = canevas.getContext('2d')
    if (ctx === null) return null
    const t = new THREE.CanvasTexture(canevas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    m.map?.dispose()
    m.map = t
    m.emissiveMap = t
    return { ctx, t, ...f }
  }
  const a = { petits: atlas(formats.petits, matieres.petites), grands: atlas(formats.grands, matieres.grandes) }
  const travaux: (() => Promise<void>)[] = []
  // Les grands d'abord : ce sont eux qu'on voit en entrant.
  for (const c of [...cadres].sort((p, q) => Number(q.grand) - Number(p.grand))) {
    const e = journal.etapes[c.etape]
    const f = c.grand ? a.grands : a.petits
    if (!f) continue
    const [x, y] = [(c.case % f.cols) * f.cote, Math.floor(c.case / f.cols) * f.cote]
    const boite = passePartout(f.ctx, e, x, y, f.cote, c.grand, journal.categories)
    const img = e.image
    if (img)
      travaux.push(async () => {
        const bmp = await image(img.src, boite)
        f.ctx.drawImage(bmp, boite.x, boite.y)
        bmp.close()
      })
  }
  const envoyer = () => {
    if (a.petits) a.petits.t.needsUpdate = true
    if (a.grands) a.grands.t.needsUpdate = true
  }
  envoyer()
  // Quatre téléchargements à la fois ; l'atlas repart vers la carte graphique au plus deux fois par seconde.
  let dernier = performance.now()
  const ouvrier = async () => {
    for (let job = travaux.shift(); job && vivant.ok; job = travaux.shift()) {
      await job().catch(() => undefined)
      if (performance.now() - dernier > 500) {
        dernier = performance.now()
        envoyer()
      }
    }
  }
  await Promise.all([ouvrier(), ouvrier(), ouvrier(), ouvrier()])
  if (vivant.ok) envoyer()
}
