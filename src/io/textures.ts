/**
 * LOT 4 — Les cartes PBR, chargées une seule fois (spec §9.4).
 *
 * Le lot 2 rendait le bâtiment en aplats : des `MeshStandardMaterial` nus, une
 * couleur par surface. À l'écran, un mur de béton et un sol de marbre ne se
 * distinguaient que par leur teinte, et rien — aucun grain, aucun relief — ne
 * donnait l'échelle. Le §9.4 tranche : six matières CC0 d'ambientCG, trois
 * cartes chacune (couleur, normale, rugosité). Le déplacement et la métallicité
 * sont écartés : sans tessellation le premier ne fait rien, et aucune des six
 * matières n'a de métallicité variable.
 *
 * Ce fichier ne contient que la moitié « fichiers » du chemin : où sont les
 * images, comment on les déclare au GPU, et comment on évite de les charger
 * deux fois. La moitié « rendu » — répétition, réglages, matériaux — vit dans
 * `scene/materials.ts`. Il n'importe ni react ni `@react-three/fiber` : tout ce
 * qu'il fait se vérifie en injectant un chargeur, sans canvas.
 *
 * ── LE PIÈGE, et il délave TOUT ──
 *
 * L'espace colorimétrique n'est PAS le même pour les trois cartes. La couleur
 * est un albédo encodé en sRGB : sans `SRGBColorSpace`, three la prend pour du
 * linéaire et la matière apparaît délavée, trop claire dans les demi-tons. La
 * normale et la rugosité, elles, sont des DONNÉES et non des couleurs : leur
 * appliquer la conversion sRGB → linéaire tord la normale (le relief part de
 * travers) et écrase la rugosité vers zéro (tout devient brillant). Les deux
 * erreurs sont silencieuses et se compensent à moitié à l'œil, ce qui est le
 * pire des cas — on voit que « ça ne va pas » sans voir quoi.
 *
 * ── Mutualisation ──
 *
 * Le bâtiment compte ~70 murs et 5 dalles. Charger les cartes par maillage
 * ferait 200 téléchargements et autant de décodages JPEG pour six matières
 * distinctes. Le cache est donc ici, à la PROMESSE : deux appels concurrents
 * pour la même matière partagent la même requête, et les appels suivants
 * rendent les mêmes objets `Texture`. Les variations d'échelle (la répétition)
 * se font par CLONAGE côté `materials.ts` — un clone partage la `Source`, donc
 * l'image décodée et l'unique texture GPU.
 */
import * as THREE from 'three'

// ── Contrat public ───────────────────────────────────────────────────────

/**
 * Les six matières du bâtiment (spec §9.4).
 *
 * Les identifiants sont les nôtres, pas ceux d'ambientCG : le jour où
 * `Concrete034` est remplacé par un meilleur béton, une ligne de
 * `SOURCE_AMBIENTCG` change et rien d'autre.
 */
export type MatiereId =
  | 'beton'
  /**
   * Le béton de l'ENVELOPPE, plus clair que celui des dalles.
   *
   * Même carte que `beton` — c'est un rôle, pas une carrière — mais son propre
   * `gain` dans `REGLAGE_MATIERE`. Le besoin est venu du brise-soleil : un peigne
   * de lames ne se lit que par contraste avec ce qu'il raye, et sur la masse
   * sombre du béton de dalle il restait un accessoire posé sur une boîte grise.
   *
   * Il lui fallait donc un gain propre, et `beton` ne pouvait pas le lui donner :
   * la même matière porte les SOUS-FACES DE DALLE, dont le gain vient tout juste
   * d'être baissé de 1,45 à 1,15 parce qu'elles brûlaient sous les plafonniers.
   * Un seul réglage ne peut pas éclaircir la façade et assombrir le plafond.
   */
  | 'beton-blanc'
  | 'platre'
  | 'platre-peint'
  | 'parquet'
  | 'marbre'
  | 'metal'
  | 'herbe'
  | 'gravier'

/** Les trois cartes d'une matière, prêtes à être posées sur un matériau. */
export interface JeuDeCartes {
  /** Albédo. sRGB. */
  couleur: THREE.Texture
  /** Normale, convention OpenGL (vert vers le haut). Données brutes. */
  normale: THREE.Texture
  /** Rugosité, lue sur le canal vert par three. Données brutes. */
  rugosite: THREE.Texture
}

/**
 * Ce que `materials.ts` attend d'un chargeur. `THREE.TextureLoader` le satisfait
 * tel quel ; les tests en injectent un qui rend des textures synthétiques, ce qui
 * est le seul moyen de vérifier la colorimétrie sans navigateur.
 */
export interface ChargeurDeTextures {
  load(
    url: string,
    onLoad?: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): THREE.Texture
}

// ── Emplacements ─────────────────────────────────────────────────────────

/**
 * Dossier des matières, RELATIF à la base du site. Sur GitHub Pages le site vit
 * sous `/<dépôt>/` : un chemin absolu `/assets/…` y donnerait un 404 que seule
 * la console révélerait. Même convention que `arrayTexture.ts`.
 */
export const MATERIALS_PATH = 'assets/materials/'

/** Identifiant ambientCG de chaque matière. Voir `public/assets/CREDITS.md`. */
export const SOURCE_AMBIENTCG: Record<MatiereId, string> = {
  beton: 'Concrete034',
  // La MÊME planche que `beton`. Voir `ALIAS_DE_CARTES` juste en dessous : sans
  // lui, ce doublon ferait retélécharger trois JPEG et allouer un second jeu de
  // textures GPU pour des pixels identiques.
  'beton-blanc': 'Concrete034',
  platre: 'Plaster001',
  'platre-peint': 'PaintedPlaster017',
  parquet: 'WoodFloor007',
  // L'identifiant du domaine reste `marbre` alors que la source est un
  // terrazzo : c'est le rôle qui nomme la matière ici, pas la carrière. Le
  // renommer ferait toucher une dizaine de fichiers pour ne rien changer au
  // rendu — et l'en-tête dit déjà que ce niveau d'indirection existe pour ça.
  marbre: 'Terrazzo005',
  metal: 'Metal032',
  herbe: 'Grass004',
  gravier: 'Gravel023',
}

/** Les trois URL d'une matière. */
export interface CheminsDeMatiere {
  couleur: string
  normale: string
  rugosite: string
}

/**
 * Où sont les trois fichiers d'une matière.
 *
 * `NormalGL` et non `NormalDX` : three attend la convention OpenGL, dont le
 * canal vert pointe vers le haut. La carte DirectX est son miroir vertical, et
 * la prendre par erreur inverse le relief — les creux deviennent des bosses, ce
 * qui ne se lit qu'en lumière rasante et se confond avec « la normale ne marche
 * pas ».
 */
export function cheminsDeMatiere(
  id: MatiereId,
  base: string = import.meta.env.BASE_URL,
): CheminsDeMatiere {
  const nom = SOURCE_AMBIENTCG[id]
  const prefixe = `${base}${MATERIALS_PATH}${nom}/${nom}_1K-JPG_`
  return {
    couleur: `${prefixe}Color.jpg`,
    normale: `${prefixe}NormalGL.jpg`,
    rugosite: `${prefixe}Roughness.jpg`,
  }
}

// ── Paramétrage ──────────────────────────────────────────────────────────

/**
 * Filtrage anisotrope. Un sol de marbre est presque toujours vu en rasant :
 * sans anisotropie il part en bouillie scintillante à trois mètres, et c'est le
 * défaut qui trahit le plus vite une texture posée à la va-vite. 8 est en deçà
 * du maximum de tout GPU de bureau ; three plafonne de toute façon à la capacité
 * réelle.
 */
export const ANISOTROPIE = 8

/**
 * Déclare les trois cartes au GPU.
 *
 * C'est ICI, et nulle part ailleurs, que se décide l'espace colorimétrique — le
 * réglage qui délave tout quand il est faux (voir l'en-tête). Il doit être posé
 * AVANT le premier téléversement : three fige l'espace au moment où il envoie
 * les octets, le changer après ne recompile rien.
 *
 * Le bouclage est `RepeatWrapping` sur les trois : la répétition en coordonnées
 * monde de `materials.ts` sort du carré unité par construction, et un
 * `ClampToEdgeWrapping` étirerait le dernier texel sur tout le mur.
 */
export function configurerJeu(jeu: JeuDeCartes): JeuDeCartes {
  jeu.couleur.colorSpace = THREE.SRGBColorSpace
  // Une normale et une rugosité sont des DONNÉES : leur appliquer la courbe sRGB
  // tord le relief et écrase la rugosité vers le brillant.
  jeu.normale.colorSpace = THREE.NoColorSpace
  jeu.rugosite.colorSpace = THREE.NoColorSpace

  for (const carte of [jeu.couleur, jeu.normale, jeu.rugosite]) {
    carte.wrapS = THREE.RepeatWrapping
    carte.wrapT = THREE.RepeatWrapping
    // L'anisotropie fait partie de la CLÉ DE CACHE d'une texture dans three :
    // deux clones qui ne s'accordent pas dessus donnent deux textures GPU au
    // lieu d'une. La poser sur le maître, avant tout clonage, est ce qui garantit
    // la mutualisation.
    carte.anisotropy = ANISOTROPIE
    carte.needsUpdate = true
  }

  return jeu
}

// ── Chargement mutualisé ─────────────────────────────────────────────────

/**
 * Une promesse par matière, jamais deux. Le cache est au niveau du MODULE et non
 * d'un composant : deux salles montées en même temps doivent partager la
 * requête, et un démontage ne doit pas la relancer.
 */
const enCours = new Map<MatiereId, Promise<JeuDeCartes>>()
const chargees = new Map<MatiereId, JeuDeCartes>()

/**
 * Abonnés au cache. Le chargement est un système EXTÉRIEUR à React : le prévenir
 * par un abonnement plutôt que par un `setState` dans un effet est ce qui évite
 * la cascade de rendus qu'une matière arrivée déclencherait sur les vingt salles
 * qui l'attendent.
 */
const abonnes = new Set<() => void>()

/** S'abonne à l'arrivée d'une matière, quelle qu'elle soit. Rend le désabonnement. */
export function abonnerAuxMatieres(ecouteur: () => void): () => void {
  abonnes.add(ecouteur)
  return () => {
    abonnes.delete(ecouteur)
  }
}

/** Charge une image et rend sa texture, une fois les octets réellement arrivés. */
function chargerCarte(
  chargeur: ChargeurDeTextures,
  url: string,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    chargeur.load(
      url,
      (texture) => resolve(texture),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(`échec ${url}`)),
    )
  })
}

/**
 * Les trois cartes d'une matière, chargées au plus une fois par exécution.
 *
 * Le `chargeur` n'est lu qu'au PREMIER appel pour une matière donnée : c'est la
 * conséquence directe de la mutualisation, et c'est voulu — un second appelant
 * ne doit pas pouvoir imposer un autre chemin de chargement à une texture déjà
 * en vol.
 */
/**
 * Les matières qui PARTAGENT les cartes d'une autre.
 *
 * `beton-blanc` n'est pas une planche distincte : c'est `beton` avec un autre
 * gain. Sans cet alias, il déclencherait son propre chargement — trois JPEG
 * retéléchargés et un second jeu de textures GPU pour des pixels rigoureusement
 * identiques, ce qui est exactement la mutualisation que l'en-tête de ce fichier
 * existe pour garantir.
 *
 * L'alias est résolu au CACHE, pas à l'appel : deux identifiants différents
 * doivent tomber sur la même entrée, sinon la mutualisation ne tient que si les
 * deux demandent en même temps.
 */
const ALIAS_DE_CARTES: Partial<Record<MatiereId, MatiereId>> = {
  'beton-blanc': 'beton',
}

const resoudre = (id: MatiereId): MatiereId => ALIAS_DE_CARTES[id] ?? id

export function chargerMatiere(
  demande: MatiereId,
  chargeur: ChargeurDeTextures = new THREE.TextureLoader(),
): Promise<JeuDeCartes> {
  const id = resoudre(demande)
  const dejaEnVol = enCours.get(id)
  if (dejaEnVol) return dejaEnVol

  const chemins = cheminsDeMatiere(id)
  const promesse = Promise.all([
    chargerCarte(chargeur, chemins.couleur),
    chargerCarte(chargeur, chemins.normale),
    chargerCarte(chargeur, chemins.rugosite),
  ]).then(([couleur, normale, rugosite]) => {
    const jeu = configurerJeu({ couleur, normale, rugosite })
    chargees.set(id, jeu)
    for (const ecouteur of abonnes) ecouteur()
    return jeu
  })

  // Un échec réseau ne doit pas laisser un rejet mémorisé pour toujours : on
  // retire la promesse du cache pour qu'un remontage puisse retenter. Sans ça,
  // une coupure d'une seconde condamne la matière pour toute la session.
  promesse.catch(() => {
    enCours.delete(id)
  })

  enCours.set(id, promesse)
  return promesse
}

/**
 * Les cartes d'une matière SI elles sont déjà là.
 *
 * Sert au premier rendu : un composant qui remonte alors que la matière est
 * chargée doit la poser tout de suite, sans repasser par un état « pas encore
 * texturé » qui ferait clignoter la surface en aplat pendant une image.
 */
export function matiereEnCache(id: MatiereId): JeuDeCartes | undefined {
  // L'alias se résout ICI aussi, sinon `beton-blanc` répondrait « pas encore
  // chargé » alors que ses cartes sont en mémoire depuis longtemps — et la
  // façade resterait en aplat le temps d'un chargement qui n'aurait jamais lieu.
  return chargees.get(resoudre(id))
}

/**
 * Vide le cache. Réservé aux tests : deux cas de test ne doivent pas se passer
 * des textures sous la table, sans quoi leur ordre d'exécution devient un
 * paramètre caché.
 */
export function viderCacheDeMatieres(): void {
  enCours.clear()
  chargees.clear()
}
