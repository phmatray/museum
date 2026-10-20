/**
 * Les visiteurs du musée (PNJ), générés par Meshy (https://docs.meshy.ai) à partir
 * d'une garde-robe tirée au sort, mais de façon reproductible :
 *
 *   MESHY_API_KEY=… node tools/generer-pnj.ts            # les PNJ manquants
 *   MESHY_API_KEY=… node tools/generer-pnj.ts --seul=3   # seulement le n° 3
 *   node tools/generer-pnj.ts --prompts                  # voir les tenues, sans rien générer
 *
 * Pour chaque visiteur : modèle (text-to-3d preview, topologie « smart » allégée, A-pose),
 * texture (refine), squelette (rigging, taille du visiteur), puis UN fichier avec trois
 * actions de la bibliothèque (marche décontractée, attente, regard qui flâne).
 * Sortie : `public/assets/pnj/pnj-<n>.glb` (à passer ensuite par `node tools/compresser-glb.ts`)
 * et `public/assets/pnj/pnj.json` (tenue, taille, tâches Meshy : on reprend là où l'on s'est arrêté).
 *
 * La clé n'est lue que dans l'environnement : jamais écrite dans le dépôt.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const API = 'https://api.meshy.ai/openapi'
const DOSSIER = resolve(import.meta.dirname, '../public/assets/pnj')
const ETAT = resolve(DOSSIER, 'pnj.json')
/** Combien de visiteurs distincts (les PNJ du musée et du jardin se les partagent). */
export const NOMBRE = 8
/** Les actions de la bibliothèque Meshy : marche, attente, regard qui flâne (devant une toile). */
export const ACTIONS = { marche: 30, attente: 0, regard: 338 } as const

/** Un générateur pseudo-aléatoire reproductible (mulberry32). */
export function hasard(graine: number): () => number {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SILHOUETTES = [
  { qui: 'young woman in her twenties', taille: 1.66 },
  { qui: 'man in his thirties', taille: 1.79 },
  { qui: 'elderly woman in her seventies', taille: 1.6 },
  { qui: 'elderly man in his seventies', taille: 1.72 },
  { qui: 'teenage girl', taille: 1.6 },
  { qui: 'middle-aged woman', taille: 1.68 },
  { qui: 'young man in his twenties', taille: 1.83 },
  { qui: 'middle-aged man', taille: 1.76 },
] as const
const COIFFURES = [
  'short curly black hair', 'long straight auburn hair', 'grey hair in a neat bun', 'closely shaved head',
  'blonde bob haircut', 'long dark braids', 'wavy brown hair under a knitted beanie', 'short silver hair',
  'messy chestnut hair', 'sleek black ponytail',
]
const HAUTS = [
  'a navy wool coat', 'a mustard turtleneck sweater', 'a denim jacket over a white t-shirt', 'an olive green parka',
  'a striped breton shirt', 'a beige trench coat', 'a burgundy cardigan', 'a light grey hoodie', 'a tweed blazer',
  'a rust-coloured knit sweater',
]
const BAS = ['dark blue jeans', 'charcoal trousers', 'a pleated plaid skirt', 'black leggings', 'khaki chinos', 'brown corduroy trousers']
const CHAUSSURES = ['white sneakers', 'brown leather boots', 'black loafers', 'canvas shoes']
const ACCESSOIRES = ['a canvas tote bag on the shoulder', 'a small crossbody bag', 'round glasses', 'a long knitted scarf', 'a small backpack', '']

export interface Tenue { n: number; qui: string; taille: number; prompt: string }

/** La tenue du visiteur n (0…NOMBRE−1) : silhouettes toutes différentes, le reste tiré au sort sans répétition. */
export function tenues(graine = 1867): Tenue[] {
  const r = hasard(graine)
  const melange = <T>(l: readonly T[]) => [...l].map((v) => [r(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  const [coiffures, hauts, bas, chaussures] = [melange(COIFFURES), melange(HAUTS), melange(BAS), melange(CHAUSSURES)]
  return SILHOUETTES.slice(0, NOMBRE).map((s, n) => {
    const accessoire = ACCESSOIRES[Math.floor(r() * ACCESSOIRES.length)]
    const habits = `wearing ${hauts[n % hauts.length]}, ${bas[n % bas.length]} and ${chaussures[n % chaussures.length]}${accessoire ? `, with ${accessoire}` : ''}`
    return {
      n,
      qui: s.qui,
      taille: s.taille,
      prompt: `Full-body ${s.qui} visiting an art museum, ${coiffures[n % coiffures.length]}, ${habits}. ` +
        'Realistic proportions, natural colours, neutral relaxed face, A-pose with arms slightly away from the body, ' +
        'feet flat, nothing in the hands, clean game-ready character.',
    }
  })
}

interface Taches { apercu?: string; texture?: string; squelette?: string; animation?: string; fichier?: string }
type Etat = Record<string, Tenue & { taches: Taches }>

const cle = process.env.MESHY_API_KEY
const entetes = () => ({ Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' })
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function appel(chemin: string, corps?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- réponses Meshy
  for (let essai = 0; ; essai++) {
    const r = await fetch(`${API}${chemin}`, { method: corps ? 'POST' : 'GET', headers: entetes(), body: corps ? JSON.stringify(corps) : undefined })
    if (r.status === 429 && essai < 8) { await attendre(5000 * (essai + 1)); continue }
    if (!r.ok) throw new Error(`${chemin} : ${r.status} ${await r.text()}`)
    return r.json()
  }
}

/** Lance une tâche et attend sa fin ; rend la tâche terminée. */
async function tache(chemin: string, corps: unknown | null, id: string | undefined, noter: (id: string) => void, nom: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!id) {
    id = (await appel(chemin, corps)).result as string
    noter(id)
  }
  for (;;) {
    const t = await appel(`${chemin}/${id}`)
    if (t.status === 'SUCCEEDED') return t
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${nom} : ${t.status} ${JSON.stringify(t.task_error)}`)
    process.stdout.write(`  ${nom} ${t.progress ?? 0} %\r`)
    await attendre(8000)
  }
}

async function generer(t: Tenue, etat: Etat, sauver: () => void): Promise<void> {
  const e = (etat[t.n] ??= { ...t, taches: {} })
  const k = e.taches
  const nom = `pnj-${t.n}`
  const noter = (champ: keyof Taches) => (id: string) => { k[champ] = id; sauver() }
  await tache('/v2/text-to-3d', { mode: 'preview', prompt: t.prompt, model_type: 'smart-topology', target_polycount: 9000, pose_mode: 'a-pose', target_formats: ['glb'] }, k.apercu, noter('apercu'), `${nom} modèle`)
  await tache('/v2/text-to-3d', { mode: 'refine', preview_task_id: k.apercu, texture_resolution: '2k', target_formats: ['glb'] }, k.texture, noter('texture'), `${nom} texture`)
  await tache('/v1/rigging', { input_task_id: k.texture, height_meters: t.taille }, k.squelette, noter('squelette'), `${nom} squelette`)
  const a = await tache('/v1/animations', { rig_task_id: k.squelette, action_ids: [ACTIONS.marche, ACTIONS.attente, ACTIONS.regard] }, k.animation, noter('animation'), `${nom} animations`)
  const url = a.result?.animation_glb_url as string | undefined
  if (!url) throw new Error(`${nom} : pas de GLB animé (${JSON.stringify(a.result)})`)
  const glb = Buffer.from(await (await fetch(url)).arrayBuffer())
  writeFileSync(resolve(DOSSIER, `${nom}.glb`), glb)
  k.fichier = `${nom}.glb`
  sauver()
  console.log(`  ${nom} : ${(glb.length / 1e6).toFixed(1)} Mo`)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const liste = tenues()
  if (args.includes('--prompts')) {
    for (const t of liste) console.log(`${t.n} (${t.taille} m) ${t.prompt}\n`)
    process.exit(0)
  }
  if (!cle) throw new Error('MESHY_API_KEY manque dans l’environnement')
  mkdirSync(DOSSIER, { recursive: true })
  const etat: Etat = existsSync(ETAT) ? JSON.parse(readFileSync(ETAT, 'utf8')) : {}
  const sauver = () => writeFileSync(ETAT, `${JSON.stringify(etat, null, 2)}\n`)
  const seul = args.find((a) => a.startsWith('--seul='))?.split('=')[1]
  const aFaire = liste.filter((t) => (seul === undefined || String(t.n) === seul) && !(etat[t.n]?.taches.fichier && existsSync(resolve(DOSSIER, etat[t.n].taches.fichier!))))
  const resultats = await Promise.allSettled(aFaire.map((t) => generer(t, etat, sauver)))
  resultats.forEach((r, i) => r.status === 'rejected' && console.error(`pnj-${aFaire[i].n} : ${r.reason}`))
  console.log(`${resultats.filter((r) => r.status === 'fulfilled').length}/${aFaire.length} visiteurs générés`)
}
