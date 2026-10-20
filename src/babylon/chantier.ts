/**
 * La baraque du CHANTIER DU MUSÉE (ChantierLayer.tsx, `plan/chantier.ts`) : la
 * charpente, le lambris et la verrière de `assets/architecture/chantier.glb`,
 * posés tels quels (repère du plan, plancher à 0,4), et le journal de chantier
 * accroché dedans, une étape par cadre.
 *
 * Cadres : deux atlas (petits, grands), chaque case le passe-partout d'une
 * étape ; un maillage de cases et un de moulures par taille, 4 appels. Les
 * images du journal ne se téléchargent qu'à l'approche (< 35 m), une fois.
 * Avant, les cases portent une carte crème 2 × 2 ; à l'approche, l'atlas la
 * remplace : les deux matières d'images sont dans VIVANTES (etat.ts).
 *
 * ponytail : pas de carte d'étape (cadreVise → gameStore.etape de three) tant
 * que la tranche n'a pas d'interface ; `cadreVise` de plan/chantier.ts la donnera.
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import type { EtapeJournal, Journal } from '../domain/journal.ts'
import type { Box } from '../plan/mesh.ts'
import { accrocherChantier, CENTRE_CHANTIER, type CadreChantier } from '../plan/chantier.ts'
import { boitesFusionnees, matiere } from './boites.ts'
import { auCiel, auCielMatiere, VIVANTES } from './etat.ts'
import { fusionnerParMatiere, glbOuRien } from './glb.ts'
import { brancherLueurs } from './lueurs.ts'
import { police } from './polices.ts'
import { maillageDeQuads, type Quad } from './textes.ts'
import { couper } from './toiles.ts'

/** À 35 m, on commence à charger les images : la baraque se voit déjà nettement. */
const APPROCHE = 35
/** Côté d'atlas visé, en pixels ; les grands cadres ont des cases de 768 px, trois par rang. */
const ATLAS = 2048
const CASE_GRANDE = 768
/** La moulure : sa largeur (petit, grand) et sa saillie sur le lambris. */
const MOULURE = { petit: 0.022, grand: 0.07, saillie: 0.035 }
const CREME = '#efe7d6'
const ENCRE = '#2a2520'
const SERIF = 'PT Serif'
const SANS = 'PT Sans'

/** Les couleurs des catégories du journal (recopiées de hooks/useChantier.ts, qui tire React). */
const TEINTE_CATEGORIE: Record<string, string> = {
  hall: '#b08d57', galeries: '#9a3b2c', jardin: '#5f7d3a', bavette: '#c47a36', ambiance: '#3e5c86', site: '#6b6660', idees: '#7d5f93',
}
const teinteCategorie = (c: string) => TEINTE_CATEGORIE[c] ?? '#6b6660'

export interface Format { cols: number; cote: number; l: number; h: number }

export function atlasDe(n: number, grand: boolean): Format {
  const cols = grand ? Math.min(3, Math.max(1, n)) : Math.max(1, Math.ceil(Math.sqrt(n)))
  const cote = grand ? CASE_GRANDE : Math.floor(ATLAS / cols)
  return { cols, cote, l: cols * cote, h: Math.ceil(n / cols) * cote }
}

/** Le quad d'une case, dans le plan du cadre, 4 mm devant lui ; ses UV sur la case `k` (haut du canevas en v = 1). */
export function quadDeCase(c: CadreChantier, m: number, k: number, a: Format): Quad {
  const [nx, nz] = c.normal
  // Face au mur, la droite du visiteur : (−n) × y ; droite × haut = n.
  const [rx, rz] = [nz, -nx]
  const [cx, cy] = [(k % a.cols) * a.cote, Math.floor(k / a.cols) * a.cote]
  return {
    centre: [c.x + nx * 0.004, c.y, c.z + nz * 0.004],
    droite: [rx, 0, rz],
    haut: [0, 1, 0],
    l: c.cote - 2 * m,
    h: c.cote - 2 * m,
    uv: [cx / a.l, 1 - (cy + a.cote) / a.h, (cx + a.cote) / a.l, 1 - cy / a.h],
  }
}

/** Les quatre baguettes de la moulure d'un cadre : elle part du lambris (2 cm derrière la case) et saille de `saillie`. */
export function moulure(c: CadreChantier, m: number): Box[] {
  const [nx, nz] = c.normal
  const [rx, rz] = [nz, -nx]
  const s = MOULURE.saillie
  const [x, z] = [c.x + nx * (s / 2 - 0.02), c.z + nz * (s / 2 - 0.02)]
  const h = c.cote / 2
  return [[0, h - m / 2, c.cote, m], [0, -h + m / 2, c.cote, m], [-h + m / 2, 0, m, c.cote - 2 * m], [h - m / 2, 0, m, c.cote - 2 * m]].map(([u, v, l, t]) => ({
    x: x + rx * u, y: c.y + v, z: z + rz * u, w: Math.abs(rx) * l + Math.abs(nx) * s, h: t, d: Math.abs(rz) * l + Math.abs(nz) * s, kind: 'wall',
  }))
}

// ── La peinture des atlas (ChantierLayer.tsx, recopiée) ─────────────────────

/** La case d'une étape, sans son image : le passe-partout, le numéro, le titre. Rend la boîte réservée à l'image. */
function passePartout(ctx: CanvasRenderingContext2D, e: EtapeJournal, x: number, y: number, c: number, grand: boolean, categories: Record<string, string>) {
  ctx.fillStyle = CREME
  ctx.fillRect(x, y, c, c)
  const teinte = teinteCategorie(e.categorie)
  const marge = Math.round(c * 0.07)
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
    couper(ctx, e.titre, img.l, 2).forEach((l, i) => ctx.fillText(l, img.x, haut + c * 0.05 + i * c * 0.062))
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
    couper(ctx, e.titre, img.l - l, 3).forEach((t, i) => ctx.fillText(t, img.x + l, haut + c * 0.012 + i * c * 0.074))
  }
  return img
}

/** L'image « couvrante » : recadrée au centre pour remplir la boîte, réduite à sa taille au décodage. */
async function image(base: string, src: string, boite: { l: number; h: number }): Promise<ImageBitmap> {
  const r = await fetch(`${base}journal/${src}`)
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

/** Peint les deux atlas : passe-partout tout de suite, puis les images, les grands d'abord, quatre à la fois. */
async function peindre(scene: Scene, base: string, journal: Journal, cadres: CadreChantier[], formats: { petits: Format; grands: Format }, mats: { petites: PBRMaterial; grandes: PBRMaterial }) {
  await Promise.all([police('PT Serif'), police('PT Sans')])
  const atlas = (f: Format, m: PBRMaterial) => {
    if (f.l === 0 || f.h === 0) return null
    const dt = new DynamicTexture(m.name, { width: f.l, height: f.h }, scene, true)
    dt.anisotropicFilteringLevel = 8
    m.albedoTexture?.dispose()
    m.albedoTexture = m.emissiveTexture = dt
    return { ctx: dt.getContext() as CanvasRenderingContext2D, dt, ...f }
  }
  const a = { petits: atlas(formats.petits, mats.petites), grands: atlas(formats.grands, mats.grandes) }
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
        const bmp = await image(base, img.src, boite)
        f.ctx.drawImage(bmp, boite.x, boite.y)
        bmp.close()
      })
  }
  const envoyer = () => {
    a.petits?.dt.update(true)
    a.grands?.dt.update(true)
  }
  envoyer()
  // Quatre téléchargements à la fois ; l'atlas repart vers la carte graphique au plus deux fois par seconde.
  let dernier = performance.now()
  const ouvrier = async () => {
    for (let job = travaux.shift(); job; job = travaux.shift()) {
      await job().catch(() => undefined)
      if (performance.now() - dernier > 500) {
        dernier = performance.now()
        envoyer()
      }
    }
  }
  await Promise.all([ouvrier(), ouvrier(), ouvrier(), ouvrier()])
  envoyer()
}

/** Les cadres du journal ; rend les moulures (porteuses d'ombre). */
function monterCadres(scene: Scene, base: string, journal: Journal, camera: Camera): Mesh[] {
  const cadres = accrocherChantier(journal.etapes.length)
  const [p, g] = [cadres.filter((c) => !c.grand), cadres.filter((c) => c.grand)]
  const formats = { petits: atlasDe(p.length, false), grands: atlasDe(g.length, true) }
  // La même carte en albedo et en émissif dès le départ : l'atlas la remplace sans changer de programme.
  // La nuit, la baladeuse éclaire les cadres : l'image luit d'elle-même, doucement.
  const image = (nom: string) => {
    const m = matiere(nom, scene, '#ffffff', 0.82)
    const attente = new DynamicTexture(`${nom}:attente`, { width: 2, height: 2 }, scene, false)
    const ctx = attente.getContext() as CanvasRenderingContext2D
    ctx.fillStyle = CREME
    ctx.fillRect(0, 0, 2, 2)
    attente.update()
    m.albedoTexture = m.emissiveTexture = attente
    m.emissiveColor = Color3.White()
    VIVANTES.add(nom)
    auCiel((c) => (m.emissiveIntensity = 0.32 * (1 - c.jour)))
    return m
  }
  const mats = { petites: image('chantier:petites'), grandes: image('chantier:grandes') }
  const chene = matiere('chantier:chene', scene, '#2b1d14', 0.55)
  const dore = matiere('chantier:dore', scene, '#b98c3e', 0.35)
  dore.metallic = 0.85
  brancherLueurs([mats.petites, mats.grandes, chene, dore])
  const porteurs: Mesh[] = []
  for (const [liste, m, f, mat, cadre] of [[p, MOULURE.petit, formats.petits, mats.petites, chene], [g, MOULURE.grand, formats.grands, mats.grandes, dore]] as const) {
    if (liste.length === 0) continue
    const cases = maillageDeQuads(`${mat.name}:cases`, liste.map((c) => quadDeCase(c, m, c.case, f)), scene, mat)
    const baguettes = boitesFusionnees(`${cadre.name}:moulures`, liste.flatMap((c) => moulure(c, m)), scene, cadre)
    cases.receiveShadows = baguettes.receiveShadows = true
    baguettes.isPickable = false
    porteurs.push(baguettes)
  }

  // L'approche : le visiteur au rez-de-chaussée, à moins de `APPROCHE` m ; on peint une fois pour toutes.
  const suivi = scene.onBeforeRenderObservable.add(() => {
    const { x, y, z } = camera.position
    if (y - 1.62 > 2.4 || Math.hypot(x - CENTRE_CHANTIER[0], z - CENTRE_CHANTIER[1]) >= APPROCHE) return
    scene.onBeforeRenderObservable.remove(suivi)
    peindre(scene, base, journal, cadres, formats, mats).catch((e: unknown) => console.error('journal du chantier indisponible', e))
  })
  return porteurs
}

/** Rend les porteurs d'ombre (le modèle sauf ses vitres, les moulures). */
export async function monterChantier(scene: Scene, base: string, camera: Camera): Promise<Mesh[]> {
  const [c, journal] = await Promise.all([
    glbOuRien(scene, 'assets/architecture/chantier.glb'),
    fetch(`${base}data/chantier.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Journal>) : null))
      .catch(() => null),
  ])
  c?.addAllToScene()
  for (const m of c?.materials ?? []) {
    if (!(m instanceof PBRMaterial)) continue
    if (m.needAlphaBlending()) {
      // Le verre ne masque rien derrière lui (comme la verrière de la nef).
      m.disableDepthWrite = true
      m.useRadianceOverAlpha = m.useSpecularOverAlpha = false
    } else brancherLueurs([m])
    // La baladeuse brûle plus fort la nuit.
    if (m.name === 'Chantier_Ampoule') {
      auCielMatiere(m, (c) => (m.emissiveIntensity = 4 + 8 * (1 - c.jour)))
    }
  }
  const porteurs: Mesh[] = []
  for (const m of fusionnerParMatiere(c?.meshes ?? [])) {
    m.receiveShadows = true
    m.isPickable = false
    if (!m.material?.needAlphaBlending()) porteurs.push(m)
  }
  if (journal && journal.etapes.length > 0) porteurs.push(...monterCadres(scene, base, journal, camera))
  return porteurs
}
