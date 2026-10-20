/**
 * Les objets du cinéma du sous-sol, générés par Meshy (texte → modèle texturé, sans
 * squelette) : le fauteuil (répété en thin instances), l'applique dorée, l'enceinte.
 * Le reste de la salle (gradins, tentures, scène, écran, rideaux) est construit en
 * code par `src/babylon/cinema.ts`, qui ramène aussi chaque objet à sa taille réelle
 * (boîte englobante) : ici, seule la forme compte.
 *
 *   MESHY_API_KEY=… node tools/generer-cinema.ts   # les objets manquants
 *
 * Sortie : `public/assets/cinema/<nom>.glb` (puis `node tools/compresser-glb.ts`),
 * `public/assets/cinema/cinema.json` (tâches Meshy : reprise possible).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { tache } from './generer-pnj.ts'

const DOSSIER = resolve(import.meta.dirname, '../public/assets/cinema')
const ETAT = resolve(DOSSIER, 'cinema.json')

export const OBJETS = {
  fauteuil: {
    // Un SEUL fauteuil : « a single seat » avait donné un groupe de trois, en quinconce.
    prompt: 'ONE single isolated cinema theater armchair, exactly one seat and nothing else, no other chairs: ' +
      'deep red velvet upholstered high backrest and seat cushion, a padded armrest on each side, a short black metal base, ' +
      'centered, front view facing forward, game-ready, clean, realistic.',
    polys: 2000,
  },
  applique: {
    prompt: 'An ornate gilded brass wall sconce lamp for an old theater, a curved wall plate with five elegant scrolled arms ' +
      'each holding a cream fabric lampshade, art nouveau style, symmetrical, game-ready, realistic.',
    polys: 5000,
  },
  enceinte: {
    prompt: 'A compact black wall-mounted cinema loudspeaker with a dark wooden cabinet and black fabric grille, ' +
      'angled bracket, game-ready, realistic.',
    polys: 1500,
  },
} as const

type Etat = Record<string, { apercu?: string; texture?: string; fichier?: string }>

if (import.meta.main) {
  if (!process.env.MESHY_API_KEY) throw new Error('MESHY_API_KEY manque dans l’environnement')
  mkdirSync(DOSSIER, { recursive: true })
  const etat: Etat = existsSync(ETAT) ? JSON.parse(readFileSync(ETAT, 'utf8')) : {}
  const sauver = () => writeFileSync(ETAT, `${JSON.stringify(etat, null, 2)}\n`)
  const resultats = await Promise.allSettled(Object.entries(OBJETS).map(async ([nom, o]) => {
    const e = (etat[nom] ??= {})
    if (e.fichier && existsSync(resolve(DOSSIER, e.fichier))) return
    const noter = (champ: 'apercu' | 'texture') => (id: string) => { e[champ] = id; sauver() }
    await tache('/v2/text-to-3d', { mode: 'preview', prompt: o.prompt, model_type: 'smart-topology', target_polycount: o.polys, target_formats: ['glb'], origin_at: 'bottom' }, e.apercu, noter('apercu'), `${nom} modèle`)
    const t = await tache('/v2/text-to-3d', { mode: 'refine', preview_task_id: e.apercu, texture_resolution: '2k', enable_pbr: true, target_formats: ['glb'] }, e.texture, noter('texture'), `${nom} texture`)
    const glb = Buffer.from(await (await fetch(t.model_urls.glb)).arrayBuffer())
    writeFileSync(resolve(DOSSIER, `${nom}.glb`), glb)
    e.fichier = `${nom}.glb`
    sauver()
    console.log(`  ${nom} : ${(glb.length / 1e6).toFixed(1)} Mo`)
  }))
  resultats.forEach((r) => r.status === 'rejected' && console.error(String(r.reason)))
}
