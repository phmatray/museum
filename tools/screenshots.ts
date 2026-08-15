/**
 * Publie les captures de `.captures/` en planche VERSIONNÉE sous `screenshots/`.
 *
 *   node tools/capture.ts --url http://localhost:5173/   # produit .captures/
 *   node tools/screenshots.ts                            # publie screenshots/
 *
 * ── Pourquoi deux dossiers, et pas un ──
 *
 * `.captures/` est ignoré par git, et c'est une décision écrite : 56 Mo de PNG
 * en 2880×1800, dans un dépôt public, pour des images régénérables à la demande.
 * Elle reste juste — pour le TRAVAIL. Elle ne l'est pas pour la RELECTURE : on
 * ne peut pas juger un chantier de rendu sur des chiffres, et un relecteur qui
 * n'a pas Chrome, le serveur Vite et 345 Mo de sources de végétation ne peut pas
 * les refaire.
 *
 * D'où ce second dossier, qui n'est pas le premier en moins bien mais un objet
 * différent : des images de RELECTURE, redimensionnées et compressées, assez
 * fidèles pour juger une silhouette et un éclairage, assez légères pour vivre
 * dans l'historique d'un dépôt public.
 *
 * Mesuré : 56 Mo de PNG deviennent ~1,5 Mo de WebP, soit 2,7 % — le même ordre
 * de grandeur que ce que `build-media.ts` fait déjà pour les vignettes d'œuvres,
 * et pour la même raison.
 *
 * ── Ce que la planche porte, et qui n'est pas dans l'image ──
 *
 * Un `README.md` qui rappelle, pour chaque vue, CE QU'ELLE EST CENSÉE PROUVER
 * (le champ `preuve` de `capture.ts`) et les chiffres relevés au même instant.
 * Une capture sans sa preuve est une jolie image ; avec elle, c'est un contrôle.
 */
/// <reference types="node" />
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(ROOT, '.captures')
const SORTIE = resolve(ROOT, 'screenshots')

/**
 * 1440×900, c'est le viewport de `capture.ts` à DPR 1.
 *
 * Les captures sont prises en DPR 2 parce que le budget se juge sur les pixels
 * que la carte dessine vraiment. Pour la relecture, la moitié suffit : on
 * regarde une silhouette, un dégradé d'angle, une teinte — pas un texel.
 */
const LARGEUR = 1440
const QUALITE = 80

interface Mesure {
  calls: number
  triangles: number
  lights: number
  shadowCasters: number
}

interface Rapport {
  vue: string
  preuve: string
  pctSous25: number
  pctSur250: number
  luminanceMoyenne: number
  ecartType: number
  mesure: Mesure | null
}

async function main(): Promise<void> {
  let rapport: { rapports: Rapport[]; budget: Record<string, number> }
  try {
    rapport = JSON.parse(await readFile(resolve(SOURCE, 'rapport.json'), 'utf8')) as typeof rapport
  } catch {
    console.error(
      'rapport.json absent.\nLance d’abord : node tools/capture.ts --url http://localhost:5173/',
    )
    process.exit(1)
  }

  // On repart d'un dossier propre : une vue supprimée de `capture.ts` doit
  // disparaître de la planche, sinon elle y survit et documente un état que
  // plus rien ne produit — le même piège qu'un board servant un vieux JSON.
  await rm(SORTIE, { recursive: true, force: true })
  await mkdir(SORTIE, { recursive: true })

  const fichiers = (await readdir(SOURCE)).filter((f) => f.endsWith('.png'))
  const lignes: string[] = []
  let octets = 0

  for (const r of rapport.rapports) {
    const source = fichiers.find((f) => basename(f, '.png') === r.vue)
    if (source === undefined) {
      console.warn(`  ! ${r.vue} : PNG introuvable, vue ignorée`)
      continue
    }
    const cible = resolve(SORTIE, `${r.vue}.webp`)
    const info = await sharp(resolve(SOURCE, source))
      .resize({ width: LARGEUR })
      .webp({ quality: QUALITE })
      .toFile(cible)
    octets += info.size
    console.log(`  ${r.vue.padEnd(20)} ${(info.size / 1024).toFixed(0).padStart(5)} ko`)

    lignes.push(
      `### \`${r.vue}\`\n\n` +
        `![${r.vue}](${r.vue}.webp)\n\n` +
        `**Ce qu'elle prouve** — ${r.preuve}\n\n` +
        `| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |\n` +
        `|--:|--:|--:|--:|--:|--:|\n` +
        `| ${r.mesure?.calls ?? '—'} | ${r.mesure?.triangles.toLocaleString('fr-FR') ?? '—'} | ` +
        `${r.pctSous25} % | ${r.pctSur250} % | ${r.luminanceMoyenne} | ${r.ecartType} |\n`,
    )
  }

  // — Les plans cotés, s'ils ont été produits —
  //
  // Ils rejoignent la planche parce qu'ils y ont leur place : une vue 3D montre
  // ce qu'on voit, un plan montre ce qu'on ne voit PAS. Les nervures qui se
  // traversaient aux angles de l'atrium lisaient comme des nervures épaisses en
  // 3D, et sautaient aux yeux sur le plan.
  const plans = (await readdir(SOURCE)).filter((f) => f.startsWith('plan-') && f.endsWith('.svg'))
  const lignesPlans: string[] = []
  for (const p of plans.sort()) {
    const nom = basename(p, '.svg')
    const cible = resolve(SORTIE, `${nom}.png`)
    // Le SVG est rasterisé : GitHub affiche bien un SVG, mais pas toujours dans
    // un README, et un plan qu'on doit ouvrir dans un onglet à part n'est pas lu.
    const info = await sharp(resolve(SOURCE, p), { density: 110 })
      .png({ compressionLevel: 9, palette: true })
      .toFile(cible)
    octets += info.size
    console.log(`  ${nom.padEnd(20)} ${(info.size / 1024).toFixed(0).padStart(5)} ko`)
    lignesPlans.push(`### \`${nom}\`\n\n![${nom}](${nom}.png)\n`)
  }

  const pire = (k: keyof Mesure): number =>
    Math.max(...rapport.rapports.map((r) => r.mesure?.[k] ?? 0))

  await writeFile(
    resolve(SORTIE, 'README.md'),
    `# Planche de relecture\n\n` +
      `Captures du musée, régénérées par :\n\n` +
      '```bash\nnpm run dev\nnode tools/capture.ts --url http://localhost:5173/\nnode tools/screenshots.ts\n```\n\n' +
      `Elles sont ici pour qu'un chantier de RENDU se relise sans avoir à le rejouer : ` +
      `on ne juge pas un éclairage sur un tableau de chiffres, et refaire ces images demande ` +
      `Chrome, le serveur Vite et 345 Mo de sources de végétation.\n\n` +
      `Redimensionnées à ${LARGEUR} px et encodées en WebP q${QUALITE} — ` +
      `${(octets / 1024 / 1024).toFixed(2)} Mo au total, contre 56 Mo de PNG bruts. ` +
      `Les originaux en 2880×1800 restent dans \`.captures/\`, qui n'est pas versionné.\n\n` +
      `## Budget §9, sur la vue la plus chère\n\n` +
      `| Poste | Relevé | Plafond | |\n|---|--:|--:|---|\n` +
      (['calls', 'triangles', 'lights', 'shadowCasters'] as (keyof Mesure)[])
        .map((k) => {
          const v = pire(k)
          const max = rapport.budget[k]
          return `| ${k} | ${v.toLocaleString('fr-FR')} | ${max.toLocaleString('fr-FR')} | ${v <= max ? '✓' : '✗'} |`
        })
        .join('\n') +
      `\n\n` +
      `Le plafond de draw calls est dépassé, et il l'était avant ce chantier — ` +
      `le compteur est laissé rouge parce qu'il dit quelque chose de vrai. ` +
      `Le levier qui le fermerait est connu et non tiré : fusionner les murs d'un plateau ` +
      `par matière (71 murs, un appel chacun).\n\n` +
      (lignesPlans.length > 0
        ? `## Les plans cotés\n\n` +
          `Un par niveau, produits par \`node tools/plan.ts\`. Ils portent le mobilier, ` +
          `le décor et **les recouvrements**, cerclés de rouge.\n\n` +
          `Trait plein : ce qui est au sol, dans lequel on se cogne. Trait pointillé : ce qui ` +
          `est au-dessus de la tête et qu'on regarde par en dessous — c'est un plan de plafond ` +
          `réfléchi, et c'est la seule façon de voir un débord, qui par définition ne touche ` +
          `pas le sol.\n\n` +
          lignesPlans.join('\n')
        : '') +
      `## Les vues\n\n` +
      lignes.join('\n'),
  )

  console.log(
    `\n${lignes.length} vues + README.md → screenshots/ (${(octets / 1024 / 1024).toFixed(2)} Mo)`,
  )
}

main().catch((e: unknown) => {
  console.error(`Échec : ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
