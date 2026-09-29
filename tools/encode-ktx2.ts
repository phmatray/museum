/**
 * Les cartes PBR des matières, compressées pour le GPU (KTX2 / Basis Universal).
 *
 * ── Pourquoi ──
 *
 * Un JPG se décompresse en RGBA plein dans la mémoire vidéo : 1024² × 4 octets,
 * plus un tiers pour les mipmaps, soit 5,6 Mo par carte et plus de 100 Mo pour
 * les matières du musée. Une texture Basis est transcodée au chargement dans le
 * format compressé que le GPU lit tel quel (BC7, ASTC, ETC2…) : 1 octet par
 * texel au plus, quatre à huit fois moins.
 *
 * ── Comment ──
 *
 * `ktx2-encoder` embarque l'encodeur Basis en WebAssembly : rien à installer,
 * la CI (ubuntu-latest) le fait tourner comme un poste de dev. `sharp` décode.
 * Chaque `.jpg` reçoit son `.ktx2` à côté ; le site essaie le `.ktx2` et
 * retombe sur le `.jpg` si le navigateur ou le fichier manque
 * (`io/textures.ts`). Un encodage raté n'arrête rien : on le dit, et le JPG
 * reste servi.
 *
 * - la COULEUR en ETC1S, sRGB : petite à télécharger, largement suffisante
 *   pour un enduit ou un terrazzo répété tous les deux mètres ;
 * - la NORMALE en UASTC, linéaire, préréglage « carte de normales » : l'ETC1S y
 *   laisse des blocs visibles en lumière rasante ;
 * - la RUGOSITÉ en ETC1S, linéaire.
 *
 * Retournées verticalement à l'encodage : un `TextureLoader` retourne ses
 * images (`flipY`), une texture compressée ne peut pas l'être au chargement.
 *
 *     node tools/encode-ktx2.ts        # ce qui manque
 *     node tools/encode-ktx2.ts --tout # tout réencoder
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DOSSIER = join(import.meta.dirname, '..', 'public', 'assets', 'materials')
const CARTE = /_(Color|NormalGL|Roughness)\.jpg$/

async function recent(source: string, cible: string): Promise<boolean> {
  try {
    return (await stat(cible)).mtimeMs >= (await stat(source)).mtimeMs
  } catch {
    return false
  }
}

/** L'encodeur WebAssembly écrit son journal sur la sortie standard, quoi qu'on lui dise : on le fait taire le temps d'un fichier. */
async function sansBavard<T>(f: () => Promise<T>): Promise<T> {
  const [log, ecrire] = [console.log, process.stdout.write]
  console.log = () => {}
  process.stdout.write = (() => true) as typeof process.stdout.write
  try {
    return await f()
  } finally {
    console.log = log
    process.stdout.write = ecrire
  }
}

export async function encoderLesMatieres(tout = false): Promise<{ faits: number; ignores: number; echecs: number }> {
  const bilan = { faits: 0, ignores: 0, echecs: 0 }
  let encoder: typeof import('ktx2-encoder').encodeToKTX2
  let sharp: typeof import('sharp').default
  try {
    ;({ encodeToKTX2: encoder } = await import('ktx2-encoder'))
    ;({ default: sharp } = await import('sharp'))
  } catch (e) {
    console.warn(`  KTX2 : encodeur indisponible (${(e as Error).message}) — les JPG seront servis.`)
    return bilan
  }
  const decoder = async (octets: Uint8Array) => {
    const { data, info } = await sharp(octets).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
  }
  let matieres: string[] = []
  try {
    matieres = await readdir(DOSSIER)
  } catch {
    return bilan
  }
  for (const m of matieres) {
    let fichiers: string[] = []
    try {
      fichiers = await readdir(join(DOSSIER, m))
    } catch {
      continue
    }
    for (const f of fichiers.filter((f) => CARTE.test(f))) {
      const source = join(DOSSIER, m, f)
      const cible = source.replace(/\.jpg$/, '.ktx2')
      if (!tout && (await recent(source, cible))) {
        bilan.ignores++
        continue
      }
      const sorte = CARTE.exec(f)![1]
      const couleur = sorte === 'Color'
      const normale = sorte === 'NormalGL'
      try {
        const debut = performance.now()
        const ktx2 = await sansBavard(async () => encoder(await readFile(source), {
          imageDecoder: decoder,
          isUASTC: normale,
          isNormalMap: normale,
          // La compression Zstandard n'agit que sur l'UASTC ; l'ETC1S est déjà compact.
          needSupercompression: normale,
          enableRDO: normale,
          rdoQualityLevel: 1,
          isPerceptual: couleur,
          isSetKTX2SRGBTransferFunc: couleur,
          qualityLevel: 200,
          compressionLevel: 2,
          generateMipmap: true,
          isYFlip: true,
        }))
        await writeFile(cible, ktx2)
        bilan.faits++
        console.log(`  ok     ${f.replace(/\.jpg$/, '.ktx2').padEnd(40)} ${(ktx2.byteLength / 1024).toFixed(0).padStart(5)} ko  ${((performance.now() - debut) / 1000).toFixed(1)} s`)
      } catch (e) {
        bilan.echecs++
        console.warn(`  échec  ${f} — ${(e as Error).message} ; le JPG sera servi.`)
      }
    }
  }
  return bilan
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await encoderLesMatieres(process.argv.includes('--tout'))
  console.log(`KTX2 : ${b.faits} encodées, ${b.ignores} à jour, ${b.echecs} en échec.`)
}
