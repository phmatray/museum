/**
 * L'ogive à deux centres — le profil qui donne son vocabulaire au bâtiment.
 *
 * Un seul tracé, employé partout : les baies, les portes, et plus tard les côtes
 * de la lanterne. C'est cette réutilisation qui fait l'unité — un bâtiment se
 * reconnaît à ce qu'il répète, pas à ce qu'il additionne.
 *
 * ── Pourquoi une ogive à deux centres, et pas une superellipse ──
 *
 * La superellipse a été essayée sur le papier et écartée : sa clé est PLATE. Ce
 * n'est pas une ogive, c'est une anse de panier, et l'œil fait la différence
 * immédiatement même à trente mètres. L'ogive à deux centres, elle, se termine
 * en POINTE, parce que ses deux arcs s'y coupent à angle vif.
 *
 * Deux arcs de cercle de rayon `R`, centrés sur la ligne de naissance en `±c` :
 *
 *     R = (a² + f²) / 2a        c = (f² − a²) / 2a
 *
 * avec `a` la demi-portée et `f` la flèche. On vérifie que le même `R` passe par
 * la naissance `(a, 0)` ET par la clé `(0, f)` — c'est l'unique couple qui le
 * fasse, donc le tracé n'a aucun paramètre libre une fois `a` et `f` fixés.
 *
 * `c` devient NÉGATIF quand `f < a` : les centres passent à l'intérieur et l'arc
 * se surbaisse. Ce n'est pas un cas dégénéré à interdire, c'est le régime des
 * baies larges, et `R = (a²+f²)/2a` reste strictement positif quoi qu'il arrive.
 *
 * ── Le rapport 1,6 ──
 *
 * `f / a = 1,6`. C'est la proportion des baies qu'on vise, et elle n'est pas
 * arbitraire : en dessous de 1,2 la pointe se voit à peine et l'arc lit comme un
 * plein cintre raté ; au-delà de 2 il devient une lancette, qui appartient à un
 * autre siècle et à un autre bâtiment.
 *
 * ── Ce que ce module ne fait pas ──
 *
 * Il ne connaît ni les murs, ni les ouvertures, ni three au-delà de `Vector2`.
 * Il rend des points dans le repère du mur (`u` en abscisse, `v` en hauteur).
 * Qui les consomme, et pour en faire quoi, ne le regarde pas.
 *
 * Aucun aléa, aucune horloge.
 */
import * as THREE from 'three'

/** `flèche / demi-portée`. Voir l'en-tête : 1,2 est mou, 2,0 est une lancette. */
export const RAPPORT_OGIVE = 1.6

/**
 * Hauteur libre de passage sous la naissance de l'arc, en mètres.
 *
 * Quand l'arc ne peut pas monter (pas assez de linteau), il descend sur les
 * jambages — et il doit alors s'arrêter AVANT de mordre sur le passage. 2,15 m,
 * c'est la cote au-dessus de laquelle plus personne ne se baisse.
 */
export const GABARIT_PASSAGE = 2.15

/**
 * Matière à conserver au-dessus de la clé, en mètres.
 *
 * `MIN_LINTEL` de `wall.ts` vaut 4 × 3 mm : c'est le seuil au-dessous duquel le
 * mur se SÉPARE en deux morceaux. Un arc qui viendrait s'y coller produirait un
 * linteau d'un centimètre — constructible pour la triangulation, absurde à l'œil
 * et fragile au premier changement de hauteur d'étage. 35 cm est une retombée
 * qui se lit comme de la matière.
 */
export const MARGE_LINTEAU = 0.35

/**
 * En deçà, on n'arche pas.
 *
 * Un arc de 10 cm de flèche sur 2 m de portée ne se lit pas comme un arc : il se
 * lit comme un linteau mal posé, et il coûte quand même ses quatorze segments.
 * Mieux vaut une ouverture franchement rectangulaire qu'un arc qu'on hésite à
 * voir.
 */
export const FLECHE_MIN = 0.18

/**
 * Longueur d'arc visée par segment, en mètres.
 *
 * Même esprit que `MOTIF_METRES` pour les textures : la finesse se dérive d'une
 * distance de vision, pas d'un compte de segments choisi à l'œil. À 0,18 m, la
 * flèche de corde vaut moins de 2 mm sur nos rayons — sous le seuil de
 * perception à la distance où on franchit une porte.
 */
const PAS_SEGMENT = 0.18

/** Bornes du nombre total de segments d'un arc : lisible, et jamais ruineux. */
const SEGMENTS_MIN = 6
const SEGMENTS_MAX = 16

/**
 * La résolution verticale d'un arc dans la hauteur dont il dispose.
 *
 * `naissance` est la hauteur où l'arc quitte les jambages, `cle` celle de sa
 * pointe. L'ouverture d'origine allait de 0 à `hauteur` ; après arc elle va de 0
 * à `cle`, en se refermant sur les jambages à partir de `naissance`.
 */
export interface Ogive {
  naissance: number
  cle: number
}

/**
 * Place l'arc d'une ouverture posée au sol.
 *
 * ── La règle : UNE SEULE LIGNE D'IMPOSTE POUR TOUT LE BÂTIMENT ──
 *
 * Les arcs naissent tous à `GABARIT_PASSAGE`, et de là chacun monte selon sa
 * propre portée. Ce n'est pas un raccourci de calcul, c'est LE geste : ce qui
 * fait lire une enfilade d'ouvertures comme une ARCADE, et pas comme une suite
 * de trous indépendants, c'est que leurs naissances sont alignées. Des arcs
 * chacun à sa hauteur donnent une paroi agitée ; alignés, ils donnent un
 * bâtiment.
 *
 * Le musée réel le vérifie sans qu'on ait à y toucher — ses trois gabarits
 * d'ouverture au sol tombent à 5 cm les uns des autres :
 *
 *   · 2,00 × 2,10 m (porte de service) → naissance 2,10   clé 3,70   f/a = 1,60
 *   · 1,50 × 3,70 m (porte de salle)   → naissance 2,15   clé 3,35   f/a = 1,60
 *   · 2,40 × 3,70 m (baie de salle)    → naissance 2,15   clé 3,95   f/a = 1,50
 *
 * Une seule exception, et elle est forcée : une ouverture PLUS BASSE que le
 * gabarit ne peut pas naître au-dessus de son propre sommet. Elle naît alors à
 * son sommet, ce qui est le seul choix disponible et reste cohérent — l'arc
 * s'ajoute au-dessus au lieu d'être inscrit.
 *
 * ── Ce que la clé ne peut pas faire ──
 *
 * Dépasser `hauteurMur − MARGE_LINTEAU`. C'est un plafond dur : au-delà, l'arc
 * viendrait manger le linteau, et à `MIN_LINTEL` près `wall.ts` SÉPARE le mur en
 * deux morceaux. Un arc qui casserait son propre mur est un défaut silencieux —
 * la triangulation réussirait, et la paroi disparaîtrait.
 *
 * Rend `null` quand la flèche obtenue tombe sous `FLECHE_MIN` : mieux vaut une
 * ouverture franche qu'un arc qu'on n'est pas sûr de voir.
 */
export function resoudreOgive(
  demiPortee: number,
  hauteurOuverture: number,
  hauteurMur: number,
  rapport = RAPPORT_OGIVE,
): Ogive | null {
  if (demiPortee <= 0 || hauteurOuverture <= 0) return null

  const naissance = Math.min(GABARIT_PASSAGE, hauteurOuverture)
  const cle = Math.min(naissance + rapport * demiPortee, hauteurMur - MARGE_LINTEAU)

  if (cle - naissance < FLECHE_MIN) return null
  return { naissance, cle }
}

/**
 * L'aire comprise entre la ligne de naissance et l'intrados, en m².
 *
 * ── Pourquoi une formule fermée plutôt qu'une somme de triangles ──
 *
 * C'est la valeur de RÉFÉRENCE des épreuves d'aire percée. Si elle était
 * calculée sur les mêmes points que la géométrie, elle vaudrait exactement ce
 * que la géométrie vaut, y compris quand la géométrie a tort : on mesurerait un
 * rendu au lieu de mesurer le sujet. Le piège est maison, il a déjà coûté deux
 * fois, et c'est précisément le genre d'endroit où il se glisse.
 *
 * Le polygone étant INSCRIT dans l'arc, l'aire réelle est toujours un peu plus
 * PETITE que celle-ci — et cette inégalité, elle, est vérifiable, ce qui en fait
 * une épreuve plus forte qu'une simple égalité approchée : elle prouve en plus
 * que la courbe ne gonfle jamais vers l'extérieur.
 *
 * ∫ y dx sur le demi-arc droit, paramétré par l'angle depuis son centre :
 *   ∫₀^θmax R² sin²θ dθ = R² (θmax/2 − sin 2θmax / 4)
 * Contrôle : sur un plein cintre (f = a, donc c = 0 et θmax = π/2) elle rend
 * πR²/2, c'est-à-dire un demi-disque.
 */
export function aireDOgive(demiPortee: number, fleche: number): number {
  const a = demiPortee
  const h = Math.abs(fleche)
  if (a <= 0 || h < 1e-9) return 0
  const R = (a * a + h * h) / (2 * a)
  const c = (h * h - a * a) / (2 * a)
  const t = Math.atan2(h, c)
  return 2 * R * R * (t / 2 - Math.sin(2 * t) / 4)
}

/**
 * La longueur développée de l'intrados, en mètres — `2 R θmax`.
 *
 * C'est la cote de référence de l'embrasure : une embrasure court sur toute la
 * courbe, son aire vaut donc cette longueur multipliée par la profondeur de
 * tranche. Là encore le polygone est inscrit, donc plus COURT que l'arc : une
 * inégalité vérifiable plutôt qu'une égalité approchée.
 */
export function longueurDIntrados(demiPortee: number, fleche: number): number {
  const a = demiPortee
  const h = Math.abs(fleche)
  if (a <= 0 || h < 1e-9) return 0
  const R = (a * a + h * h) / (2 * a)
  const c = (h * h - a * a) / (2 * a)
  return 2 * R * Math.atan2(h, c)
}

/**
 * Le nombre de segments d'un demi-arc, dérivé de sa longueur réelle.
 *
 * Un compte fixe donnerait une porte de service aussi finement pavée qu'une baie
 * de trois mètres — soit du gaspillage d'un côté, soit des facettes de l'autre.
 */
function segmentsParDemi(rayon: number, angle: number): number {
  const total = Math.round((2 * rayon * angle) / PAS_SEGMENT)
  return Math.ceil(Math.min(SEGMENTS_MAX, Math.max(SEGMENTS_MIN, total)) / 2)
}

/**
 * L'intrados d'un arc, de gauche à droite en passant par la clé.
 *
 * ⚠️ Rend les points STRICTEMENT INTÉRIEURS : ni la naissance gauche, ni la
 * naissance droite. C'est ce qui permet de l'insérer dans un contour existant
 * sans dupliquer de sommet — et un sommet dupliqué dans un `THREE.Shape` n'est
 * pas anodin, il produit un triangle d'aire nulle que `mergeVertices` garde.
 *
 * `cle` peut être SOUS `naissance` : l'arc se retourne alors vers le bas, ce dont
 * a besoin la moitié inférieure d'une baie en ellipse pointue.
 */
export function intrados(
  gauche: number,
  droite: number,
  naissance: number,
  cle: number,
): THREE.Vector2[] {
  const a = (droite - gauche) / 2
  const f = cle - naissance
  const sens = Math.sign(f) || 1
  const h = Math.abs(f)
  if (a <= 0 || h < 1e-9) return []

  const milieu = (gauche + droite) / 2
  // R et c : voir l'en-tête. Un seul couple fait passer le même cercle par la
  // naissance et par la clé.
  const R = (a * a + h * h) / (2 * a)
  const c = (h * h - a * a) / (2 * a)
  const angleMax = Math.atan2(h, c)

  const n = segmentsParDemi(R, angleMax)

  // Demi-arc droit, de la naissance vers la clé.
  const demi: THREE.Vector2[] = []
  for (let i = 1; i <= n; i++) {
    const t = (angleMax * i) / n
    demi.push(new THREE.Vector2(-c + R * Math.cos(t), R * Math.sin(t)))
  }

  const points: THREE.Vector2[] = []
  // Moitié gauche : le demi-arc droit mirroité en x garde le bon ORDRE (il part
  // de la naissance gauche et monte vers la clé), il n'y a donc rien à inverser.
  for (const p of demi) points.push(new THREE.Vector2(milieu - p.x, naissance + sens * p.y))
  // Moitié droite : le même demi-arc à l'envers, clé exclue — elle vient d'être
  // posée par le dernier point de la moitié gauche.
  for (let i = demi.length - 2; i >= 0; i--) {
    points.push(new THREE.Vector2(milieu + demi[i].x, naissance + sens * demi[i].y))
  }

  return points
}

/**
 * Le contour complet d'une baie en ELLIPSE POINTUE, en sens horaire.
 *
 * Deux ogives dos à dos, inscrites dans le rectangle de l'ouverture : la
 * naissance est à mi-hauteur, la clé en haut, la pointe en bas.
 *
 * ── Pourquoi INSCRITE, et non circonscrite ──
 *
 * Une ellipse pointue circonscrite ferait déborder la baie de sa propre allège :
 * sur les fenêtres réelles du musée (2,25 m utiles, allège à 0,95 m), la pointe
 * basse tomberait à −25 cm, soit SOUS LE PLANCHER. Inscrite, la baie ne fait que
 * rétrécir — donc aucun linteau ne s'amincit, aucune allège ne disparaît, et le
 * vitrage, qui reste rectangulaire et posé 16 cm en retrait, se retrouve
 * simplement recouvert dans ses angles. C'est exactement ce que fait une baie
 * appareillée réelle : la maçonnerie porte l'arc, le vitrage est derrière.
 *
 * ── Et c'est le gabarit qui a décidé, pas moi ──
 *
 * Les 33 fenêtres du musée font 1,50 m de large pour 2,25 m utiles : demi-portée
 * 0,75, demi-hauteur 1,125, soit un rapport de 1,50. Le rapport visé est 1,6. La
 * proportion existante ÉTAIT déjà celle d'une ellipse pointue à un poil près —
 * l'arc ne corrige donc pas la baie, il la révèle.
 */
export function contourDeBaie(
  gauche: number,
  droite: number,
  bas: number,
  haut: number,
): THREE.Vector2[] | null {
  const a = (droite - gauche) / 2
  const demiHauteur = (haut - bas) / 2
  if (a <= 0 || demiHauteur < FLECHE_MIN) return null

  const milieu = (bas + haut) / 2
  const haute = intrados(gauche, droite, milieu, haut)
  const basse = intrados(gauche, droite, milieu, bas)
  if (haute.length === 0 || basse.length === 0) return null

  // Sens HORAIRE, comme le rectangle qu'il remplace : naissance gauche, arc haut
  // vers la droite, naissance droite, arc bas vers la gauche.
  return [
    new THREE.Vector2(gauche, milieu),
    ...haute,
    new THREE.Vector2(droite, milieu),
    ...basse.slice().reverse(),
  ]
}
