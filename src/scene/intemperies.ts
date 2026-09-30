/**
 * Le temps et la saison, portés par les matières du musée : un jeu
 * d'uniformes PARTAGÉS (le même objet `{ value }` greffé dans chaque shader),
 * que `MeteoLayer` règle une fois par image, et les greffes `onBeforeCompile`
 * qui les lisent — le sol mouillé ou enneigé, les érables qui rougissent et se
 * dénudent, les azalées qui fleurissent, les ronds de pluie sur l'étang, les
 * filets d'eau sur la verrière. Aucune texture, aucun appel de dessin de plus.
 *
 * Toutes les greffes CHAÎNENT sur un `onBeforeCompile` déjà posé (le rebond de
 * `materials.ts`, la mousse des rochers) au lieu de l'écraser. Celles du
 * fragment se posent juste AVANT `#include <emissivemap_fragment>`, les normales
 * faites : `retoucherCartes` (materials.ts) remplace `normal_fragment_maps` par
 * son texte, et une greffe ancrée là disparaissait — les flaques du gravier ne
 * compilaient plus (`iFlaque` non déclaré), la pierre ne se mouillait pas.
 */
import * as THREE from 'three'

export const INTEMPERIES = {
  uTemps: { value: 0 },
  /** La pluie qui tombe (0..1), lissée. */
  uPluie: { value: 0 },
  /** Le sol mouillé : monte avec la pluie, sèche lentement. */
  uMouille: { value: 0 },
  /** La neige tenue au sol, sur les toits et les houppiers. */
  uEnneige: { value: 0 },
  /** Vent, m/s. */
  uVent: { value: 2 },
  uNuages: { value: 0 },
  uBrume: { value: 0 },
  /** La couleur de la brume et du ciel couvert, à l'heure qu'il est. */
  uBrumeCouleur: { value: new THREE.Color('#aab2b8') },
  /** L'éclair : un flash bref, 0 le reste du temps. */
  uEclair: { value: 0 },
  uFeuillage: { value: 0 },
  uChute: { value: 0 },
  uFloraison: { value: 0 },
  uTendre: { value: 0 },
  uFeuillesSol: { value: 0 },
  uJaune: { value: 0 },
  uTerne: { value: 0 },
}

type Shader = THREE.WebGLProgramParametersWithUniforms

const UNIFORMES = Object.entries(INTEMPERIES)
  .map(([k, u]) => `uniform ${u.value instanceof THREE.Color ? 'vec3' : 'float'} ${k};`)
  .join('\n')

/** Commun aux deux étages : les uniformes, un bruit de valeur, « dans le musée ». */
const COMMUN = /* glsl */ `
${UNIFORMES}
float iHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float iBruit(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(iHash(i), iHash(i + vec2(1, 0)), u.x), mix(iHash(i + vec2(0, 1)), iHash(i + vec2(1, 1)), u.x), u.y);
}
// Sous les toits du musée (emprise 0–48 × 0–40, toits vers 9,5 m) : ni pluie ni neige.
float iInterieur(vec3 p) { return step(-0.2, p.x) * step(p.x, 48.2) * step(-0.2, p.z) * step(p.z, 40.2) * step(p.y, 9.3); }
// Les ronds de pluie sur une eau calme (l'étang, les flaques) : la pente, en xz, à ajouter à la normale.
vec2 iRonds(vec2 xz) {
  vec2 iG = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = xz * 2.4 + float(k) * vec2(0.37, 0.71);
    vec2 c = floor(q);
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      vec2 o = c + vec2(float(i), float(j));
      float h = iHash(o + float(k) * 17.0);
      // Pas toutes les cellules à la fois : la pluie fine n'allume que les plus pressées.
      if (h > uPluie * 1.3) continue;
      float t = fract(uTemps * (0.55 + 0.4 * h) + h * 9.1);
      vec2 centre = o + 0.2 + 0.6 * vec2(h, iHash(o * 1.7 + 3.1));
      vec2 v = q - centre;
      float d = length(v);
      float r = t * 0.75;
      float anneau = exp(-pow((d - r) / 0.05, 2.0)) * (1.0 - t) * (1.0 - t);
      iG += v / max(d, 1e-3) * anneau * cos((d - r) * 60.0);
    }
  }
  return iG;
}
`

/**
 * Pose une greffe par-dessus celles déjà là. La clé de cache précédente est lue
 * MAINTENANT : la clé par défaut de three est le source de `onBeforeCompile`,
 * qui sera bientôt notre enveloppe, la même pour tous.
 */
function greffer(m: THREE.Material, cle: string, greffe: (s: Shader) => void): void {
  if ((m.userData.intemperies as string[] | undefined)?.includes(cle)) return
  const avant = m.onBeforeCompile.bind(m)
  const cleAvant = m.customProgramCacheKey()
  m.onBeforeCompile = (s, r) => {
    avant(s, r)
    greffe(s)
  }
  m.customProgramCacheKey = () => `${cleAvant}|${cle}`
  m.userData.intemperies = [...((m.userData.intemperies as string[] | undefined) ?? []), cle]
  m.needsUpdate = true
}

/** Les uniformes partagés, la position et la normale au MONDE (instances comprises). */
function avecMonde(s: Shader): void {
  Object.assign(s.uniforms, INTEMPERIES)
  if (s.vertexShader.includes('varying vec3 vMonde;')) return
  s.vertexShader = s.vertexShader
    .replace('#include <common>', `#include <common>\n${COMMUN}\nvarying vec3 vMonde;\nvarying float vHaut;`)
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  {
    vec4 iP = vec4(transformed, 1.0);
    vec3 iN = objectNormal;
    #ifdef USE_INSTANCING
      iP = instanceMatrix * iP;
      iN = mat3(instanceMatrix) * iN;
    #endif
    vMonde = (modelMatrix * iP).xyz;
    vHaut = normalize(mat3(modelMatrix) * iN).y;
  }`,
    )
  s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${COMMUN}\nvarying vec3 vMonde;\nvarying float vHaut;`)
}

/**
 * Le dehors sous le temps qu'il fait : mouillé (plus sombre, plus lisse, donc
 * luisant), puis couvert de neige par plaques sur les faces tournées vers le
 * ciel. `pelouse` y ajoute la saison de l'herbe : jaunie fin d'été, terne l'hiver.
 * `flaques` (les allées, le parvis) : sous une vraie pluie, l'eau s'y amasse en
 * flaques éparses — un miroir du ciel, sans le relief du sol — qui s'étendent
 * avec l'averse et sèchent après elle, au pas lent de `uMouille`.
 */
export function intemperer(m: THREE.Material, { pelouse = false, flaques = false } = {}): void {
  greffer(m, pelouse ? 'intemperies:pelouse' : flaques ? 'intemperies:flaques' : 'intemperies', (s) => {
    avecMonde(s)
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
  ${flaques ? 'float iFlaque = 0.0, iFilm = 0.0;' : ''}
  {
    float iDehors = 1.0 - iInterieur(vMonde);
    ${pelouse ? `
    float iL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.3, 1.12, 0.5), uJaune * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(iL) * vec3(1.1, 1.0, 0.72), uTerne * 0.5) * (1.0 - 0.1 * uTerne);` : ''}
    float iM = uMouille * iDehors;
    diffuseColor.rgb *= 1.0 - 0.38 * iM;
    float iSol = smoothstep(0.2, 0.75, vHaut);
    float iB = iBruit(vMonde.xz * 1.1) * 0.65 + iBruit(vMonde.xz * 4.7) * 0.35;
    float iNeige = smoothstep(0.38, 0.62, uEnneige * iDehors * iSol + (iB - 0.5) * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.95), iNeige);
    #ifdef STANDARD
      roughnessFactor = mix(roughnessFactor, 0.1 + 0.25 * roughnessFactor, iM * iSol);${flaques ? `
      {
        // La neige fondue (uMouille <= 0,3) ne fait pas de flaques : il faut l'averse.
        float iEau = smoothstep(0.35, 0.85, iM) * iSol * (1.0 - iNeige);
        float iF = iBruit(vMonde.xz * 0.9 + 7.3) * 0.6 + iBruit(vMonde.xz * 2.6) * 0.28 + iBruit(vMonde.xz * 9.0) * 0.12;
        float iSeuil = 0.74 - 0.05 * iEau;
        iFlaque = smoothstep(iSeuil, iSeuil + 0.015, iF) * iEau;
        iFilm = iEau * (1.0 - iFlaque);
        // Le bord imbibé, plus sombre, avant l'eau.
        float iBord = smoothstep(iSeuil - 0.06, iSeuil, iF) * iEau;
        diffuseColor.rgb *= (1.0 - 0.2 * iM * iSol) * (1.0 - 0.25 * iBord) * (1.0 - 0.7 * iFlaque);
        roughnessFactor = mix(roughnessFactor, 0.02, iFlaque);
        // L'eau est plane : ni joints ni grains, la normale se redresse vers le ciel.
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), iFlaque));
        // Et l'averse y dessine ses ronds, comme sur l'étang.
        if (iFlaque > 0.01 && uPluie > 0.01) {
          vec2 iG = iRonds(vMonde.xz) * iFlaque * min(1.0, uPluie * 2.0);
          normal = normalize(normal + (viewMatrix * vec4(iG.x, 0.0, iG.y, 0.0)).xyz * 0.9);
        }
      }` : ''}
      roughnessFactor = mix(roughnessFactor, 0.8, iNeige);
      metalnessFactor *= 1.0 - iNeige;
    #endif
  }
  #include <emissivemap_fragment>`,
    )
    // Le reflet du ciel couvert (la couleur de la brume, à l'heure qu'il est) :
    // un miroir dans les flaques, un lustre sur le reste, selon Fresnel.
    if (flaques)
      s.fragmentShader = s.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{
    float iFr = 0.02 + 0.98 * pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
    outgoingLight = mix(outgoingLight, uBrumeCouleur * 3.0, iFr * (0.9 * iFlaque + 0.06 * iFilm));
  }
  #include <opaque_fragment>`,
      )
  })
}

/**
 * Un attribut par sommet `aCarte` = (centre de sa carte, aléa de la carte) :
 * les cartes de feuillage sont des composantes connexes (4 sommets, 2
 * triangles), retrouvées par union-find sur l'index. De quoi faire tomber,
 * rougir et repousser chaque grappe à son heure.
 */
export function cartesDeFeuillage(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position')
  const parent = Array.from({ length: p.count }, (_, i) => i)
  const racine = (i: number): number => (parent[i] === i ? i : (parent[i] = racine(parent[i])))
  const index = g.getIndex()
  const n = index === null ? p.count : index.count
  const at = (k: number) => (index === null ? k : index.getX(k))
  for (let k = 0; k < n; k += 3) {
    const [a, b, c] = [racine(at(k)), racine(at(k + 1)), racine(at(k + 2))]
    parent[b] = a
    parent[racine(c)] = a
  }
  const somme = new Map<number, [number, number, number, number]>()
  for (let i = 0; i < p.count; i++) {
    const r = racine(i)
    const s = somme.get(r) ?? [0, 0, 0, 0]
    somme.set(r, [s[0] + p.getX(i), s[1] + p.getY(i), s[2] + p.getZ(i), s[3] + 1])
  }
  const carte = new Float32Array(p.count * 4)
  for (let i = 0; i < p.count; i++) {
    const r = racine(i)
    const [x, y, z, k] = somme.get(r)!
    // Un aléa stable par carte, tiré de son centre.
    const alea = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1
    carte.set([x / k, y / k, z / k, alea], 4 * i)
  }
  g.setAttribute('aCarte', new THREE.BufferAttribute(carte, 4))
}

/**
 * Le feuillage d'un érable au fil de l'année. Chaque carte tombe à son tour
 * (repliée sur son centre) quand `uChute` passe son aléa, et repousse de même
 * au printemps ; elle tourne à l'orange ou au rouge avec `uFeuillage` ; un
 * érable vert sur trois fleurit, pâle, au printemps. Le vent balance le houppier.
 * La géométrie doit porter `aCarte` (`cartesDeFeuillage`).
 */
export function saisonnerErable(m: THREE.Material, rouge: boolean): void {
  greffer(m, `saison:erable:${rouge ? 'rouge' : 'vert'}`, (s) => {
    avecMonde(s)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCarte;\nvarying vec2 vCarte;\nvarying float vNu;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  {
    float iArbre = 0.5;
    #ifdef USE_INSTANCING
      iArbre = iHash(floor(instanceMatrix[3].xz * 3.0));
    #endif
    float iTombe = smoothstep(aCarte.w * 0.85, aCarte.w * 0.85 + 0.15, uChute * 1.08 + (iArbre - 0.5) * 0.12);
    transformed = mix(transformed, aCarte.xyz, iTombe);
    float iAmp = (0.01 + 0.012 * uVent) * clamp(transformed.y / 4.5, 0.0, 1.0);
    transformed.x += sin(uTemps * 1.7 + aCarte.x * 2.3 + iArbre * 20.0) * iAmp;
    transformed.z += cos(uTemps * 1.3 + aCarte.z * 2.1 + iArbre * 11.0) * iAmp;
    vCarte = vec2(aCarte.w, iArbre);
    // Brunie en tombant.
    vNu = iTombe;
  }`,
      )
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCarte;\nvarying float vNu;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  {
    float iL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    float iTourne = smoothstep(vCarte.x * 0.7, vCarte.x * 0.7 + 0.25, uFeuillage * 1.05 + (vCarte.y - 0.5) * 0.3);
    float iTon = fract(vCarte.x * 5.1 + vCarte.y);
    ${rouge
      ? `// Les pourpres s'embrasent : cramoisi et écarlate.
    vec3 iAutomne = mix(vec3(0.55, 0.03, 0.02), vec3(0.8, 0.12, 0.02), iTon) * (0.8 + 1.4 * iL);
    diffuseColor.rgb = mix(diffuseColor.rgb, iAutomne, iTourne);`
      : `// Les verts passent à l'orange, au rouge, quelques-uns au jaune d'or.
    vec3 iAutomne = iTon < 0.45 ? vec3(0.75, 0.2, 0.015) : (iTon < 0.8 ? vec3(0.55, 0.045, 0.015) : vec3(0.78, 0.46, 0.02));
    diffuseColor.rgb = mix(diffuseColor.rgb, iAutomne * (0.6 + 0.7 * iL), iTourne);
    // Le vert tendre des jeunes feuilles.
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.2, 1.3, 0.7) + vec3(0.03, 0.05, 0.0), uTendre * (1.0 - iTourne));`}
    ${rouge ? '' : `// Au printemps, un érable vert sur trois se pique de grappes pâles, rosées.
    float iFleur = step(0.66, vCarte.y) * step(vCarte.x, 0.22) * uFloraison;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.74, 0.8) * (0.5 + 0.9 * iL), iFleur * 0.75);`}
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.16, 0.06) * (0.5 + iL), smoothstep(0.05, 0.6, vNu));
  }`,
      )
  })
}

/** L'azalée n'est rose qu'en saison : hors floraison, ses fleurs redeviennent feuilles. */
export function saisonnerAzalee(m: THREE.Material): void {
  greffer(m, 'saison:azalee', (s) => {
    avecMonde(s)
    s.fragmentShader = s.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    float iRose = smoothstep(0.06, 0.22, diffuseColor.r - diffuseColor.g);
    vec3 iFeuille = vec3(0.14, 0.27, 0.07) * (0.8 + 0.5 * fract(diffuseColor.b * 31.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, iFeuille, iRose * (1.0 - uFloraison));
  }`,
    )
  })
}

/** Les pétales tombés n'existent qu'en saison : repliés sur leur pied le reste de l'année. */
export function saisonnerPetales(m: THREE.Material): void {
  greffer(m, 'saison:petales', (s) => {
    avecMonde(s)
    s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed *= smoothstep(0.0, 0.4, uFloraison);')
  })
}

/**
 * Les ronds de pluie sur l'étang : une grille de gouttes (deux couches
 * décalées), chacune un anneau qui s'élargit et s'éteint ; sa pente penche la
 * normale. Rien n'est calculé par temps sec.
 */
export function rider(m: THREE.Material): void {
  greffer(m, 'intemperies:ronds', (s) => {
    avecMonde(s)
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
  if (uPluie > 0.01) {
    vec2 iG = iRonds(vMonde.xz);
    normal = normalize(normal + (viewMatrix * vec4(iG.x, 0.0, iG.y, 0.0)).xyz * 0.9 * min(1.0, uPluie * 2.0));
  }
  #include <emissivemap_fragment>`,
    )
  })
}

/**
 * Les filets de pluie sur un verre : des rigoles qui descendent la pente de la
 * vitre (la verrière, le pignon), serpentent un peu, et des gouttes posées.
 * Le sens de la pente est lu sur la normale : la même greffe vaut pour un
 * vitrage incliné ou d'aplomb. À plat (les lanterneaux de l'étage), l'eau ne
 * coule pas : des gouttes s'y écrasent, s'étalent et sèchent, d'autres
 * tombent — leur ombre sur le dépoli, vue d'en dessous. Et sous l'averse, le
 * verre luit moins : le ciel derrière est bas.
 */
export function ruisseler(m: THREE.Material): void {
  greffer(m, 'intemperies:filets', (s) => {
    avecMonde(s)
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
  float iFilet = 0.0;
  if (uPluie > 0.01) {
    vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec3 amont = vec3(0.0, 1.0, 0.0) - nW * nW.y;
    float lg = length(amont);
    if (lg > 0.05) {
      amont /= lg;
      vec3 cote = normalize(cross(nW, amont));
      float u = dot(vMonde, cote) * 4.0;
      float v = dot(vMonde, amont);
      float col = floor(u);
      float h = iHash(vec2(col, 3.7));
      float fu = fract(u) - 0.5 + 0.18 * sin(v * 4.0 + h * 30.0);
      float ligne = smoothstep(0.14, 0.04, abs(fu)) * step(0.45 - 0.4 * uPluie, h);
      float coule = pow(fract(v * (0.5 + h) + uTemps * (0.5 + 0.7 * h) + h * 13.0), 6.0);
      vec2 g = vec2(u * 1.3, v * 9.0);
      float goutte = smoothstep(0.35, 0.15, length(fract(g) - 0.5)) * step(0.82 - 0.2 * uPluie, iHash(floor(g)));
      iFilet = clamp(ligne * (0.35 + 0.65 * coule) + goutte * 0.7, 0.0, 1.0) * min(1.0, uPluie * 1.8);
      normal = normalize(normal + (viewMatrix * vec4(cote * fu * 0.6 * ligne, 0.0)).xyz);
    } else {
      vec2 g = vMonde.xz * 4.0;
      vec2 c = floor(g);
      float h = iHash(c + 5.3);
      // Chaque case reçoit sa goutte à son heure ; elle s'étale un peu en séchant.
      float t = fract(uTemps * (0.3 + 0.4 * h) + h * 17.0);
      vec2 o = 0.25 + 0.5 * vec2(h, iHash(c + 7.1));
      float r = (0.06 + 0.09 * h * h) * (0.8 + 0.4 * t);
      float goutte = smoothstep(r, r * 0.4, length(fract(g) - o)) * (1.0 - t * t) * step(0.9 - 0.6 * uPluie, iHash(c + 3.3));
      iFilet = goutte * 0.6 * min(1.0, uPluie * 1.8);
    }
    // Vue du dessous, contre le ciel clair, l'eau se lit plus sombre que le verre.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.19, 0.22), iFilet * 0.8);
    diffuseColor.a = min(1.0, diffuseColor.a + iFilet * 0.45);
  }
  #include <emissivemap_fragment>`,
    ).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= (1.0 - 0.8 * iFilet) * (1.0 - 0.3 * uPluie);')
  })
}

/**
 * Chaque sujet sa nuance : un buis plus jaune, un autre plus bleuté, un érable
 * un peu plus sombre que son voisin. Un aléa par instance, tiré de sa place —
 * deux copies du même modèle ne se lisent plus comme des clones. `force` :
 * 1 pour les touffes, moins pour les érables (leur saison les varie déjà).
 */
export function varierFeuillage(m: THREE.Material, force = 1): void {
  greffer(m, `nuance:${force}`, (s) => {
    avecMonde(s)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vNuance;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vNuance = 0.5;
  #ifdef USE_INSTANCING
    vNuance = iHash(floor(instanceMatrix[3].xz * 2.0) + 0.37);
  #endif`,
      )
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vNuance;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    vec3 iTeinte = mix(vec3(1.1, 1.05, 0.78), vec3(0.86, 0.97, 1.08), vNuance);
    float iVal = 0.84 + 0.3 * fract(vNuance * 7.31);
    diffuseColor.rgb *= mix(vec3(1.0), iTeinte * iVal, ${force.toFixed(2)});
  }`,
      )
  })
}

/**
 * Les herbes de berge dans le vent et au fil de l'année : chaque lame ploie
 * d'autant plus qu'elle monte (le pied reste planté), chaque touffe à son
 * rythme ; elles blondissent à l'automne et restent debout, sèches et pâles,
 * tout l'hiver — la paille des roseaux, comme au bord d'un vrai étang.
 */
export function balancerHerbes(m: THREE.Material): void {
  greffer(m, 'saison:herbes', (s) => {
    avecMonde(s)
    s.vertexShader = s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  {
    float iTouffe = 0.5;
    #ifdef USE_INSTANCING
      iTouffe = iHash(floor(instanceMatrix[3].xz * 3.0));
    #endif
    float iPoids = pow(max(transformed.y, 0.0) / 1.2, 1.6);
    float iAmp = (0.05 + 0.035 * uVent) * iPoids;
    float iPhase = uTemps * (1.6 + 0.5 * iTouffe) + iTouffe * 30.0 + transformed.x * 2.0;
    transformed.x += (sin(iPhase) * 0.8 + sin(iPhase * 2.3 + 1.7) * 0.3) * iAmp;
    transformed.z += cos(iPhase * 0.8 + transformed.z * 3.0) * iAmp * 0.7;
  }`,
    )
    s.fragmentShader = s.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  {
    float iL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    float iSec = clamp(max(uFeuillage * 0.75, uChute), 0.0, 1.0);
    vec3 iPaille = vec3(0.62, 0.5, 0.3) * (0.55 + 1.6 * iL);
    diffuseColor.rgb = mix(diffuseColor.rgb, iPaille, iSec * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.2, 0.8), uTendre * (1.0 - iSec));
  }`,
    )
  })
}

/**
 * Un mur de brique qui a vécu : des pans plus sombres ou plus roses selon les
 * fournées, des coulures verticales noircies par la pluie, verdies d'algues
 * par endroits. Lu sur la position au monde : le long d'un mur (x + z, les
 * murs sont d'équerre) et en hauteur, sans deux travées pareilles.
 */
export function vieillirBrique(m: THREE.Material): void {
  greffer(m, 'vieux:brique', (s) => {
    avecMonde(s)
    // La hauteur dans la boîte (0 au pied de la fondation, 1 sous le chaperon) :
    // les `Boites` sont un cube unité mis à l'échelle par instance.
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vDansMur;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDansMur = position.y + 0.5;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDansMur;')
      .replace(
        '#include <emissivemap_fragment>',
        `
  {
    float iS = vMonde.x + vMonde.z;
    // Les fournées : des pans plus sombres, d'autres plus roses.
    float iPan = iBruit(vec2(iS * 0.18, vMonde.y * 0.35)) * 0.7 + iBruit(vec2(iS * 0.7, vMonde.y * 1.3)) * 0.3;
    diffuseColor.rgb *= mix(vec3(0.78, 0.78, 0.8), vec3(1.08, 1.0, 0.94), iPan);
    // Les coulures, du chaperon vers le bas, chacune à sa longueur.
    float iCol = iBruit(vec2(iS * 3.1, 0.5)) * iBruit(vec2(iS * 0.45, 2.5));
    float iLong = 0.35 + 0.5 * iBruit(vec2(iS * 2.3, 7.1));
    float iCoule = smoothstep(0.2, 0.5, iCol) * smoothstep(1.0 - iLong, 1.0, vDansMur) * (0.6 + 0.4 * iBruit(vec2(iS * 9.0, vMonde.y * 0.7)));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.44, 0.42), iCoule * 0.7);
    // Le pied, qui boit l'eau du sol : plus sombre, verdi d'algues par plaques.
    float iBord = 0.3 + 0.08 * iBruit(vec2(iS * 1.5, 3.3));
    float iPied = 1.0 - smoothstep(iBord - 0.08, iBord + 0.04, vDansMur);
    float iAlgue = smoothstep(0.45, 0.75, iBruit(vec2(iS * 1.3 + 11.0, vMonde.y * 2.2)) * 0.7 + iBruit(vec2(iS * 6.0, vMonde.y * 6.0)) * 0.3);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.62, 0.58), iPied);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.78, 0.45), iAlgue * (0.2 + 0.5 * iPied));
  }
  #include <emissivemap_fragment>`,
      )
  })
}
