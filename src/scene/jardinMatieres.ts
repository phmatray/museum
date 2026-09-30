/**
 * Les matières du jardin japonais que Blender ne peut pas porter : l'eau qui
 * frémit, la cascade qui coule, et le sol creusé habillé de la pelouse du parc.
 *
 * Tout est calculé ici, rien n'est téléchargé : une carte de normales de
 * 128 px faite de sinus entiers (elle se répète sans couture) et une carte
 * d'alpha en filets pour la chute d'eau.
 */
import * as THREE from 'three'

import { BOMBE_LEVRE, INDICE_LEVRE, JARDIN, TRACE_RUISSEAU } from '../plan/jardin'
import { REMOUS_MAX, type Remous } from '../plan/ruisseau'
import { INTEMPERIES, rider } from './intemperies'

/** Des vaguelettes : une somme de sinus à fréquences ENTIÈRES, donc une tuile sans raccord. */
function carteDeVaguelettes(n = 128): THREE.DataTexture {
  const ondes = [[3, 1, 0.9, 0.3], [1, 4, 0.7, 1.7], [5, -3, 0.35, 2.9], [-2, 7, 0.25, 0.8], [8, 5, 0.15, 4.1]]
  const h = (x: number, y: number) =>
    ondes.reduce((s, [kx, ky, a, p]) => s + a * Math.sin((2 * Math.PI * (kx * x + ky * y)) / n + p), 0)
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [dx, dy] = [(h(x + 1, y) - h(x - 1, y)) / 2, (h(x, y + 1) - h(x, y - 1)) / 2]
      const l = Math.hypot(dx, dy, 1)
      const i = (y * n + x) * 4
      data.set([((-dx / l) * 0.5 + 0.5) * 255, ((-dy / l) * 0.5 + 0.5) * 255, ((1 / l) * 0.5 + 0.5) * 255, 255], i)
    }
  }
  const t = new THREE.DataTexture(data, n, n)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

/** Des filets d'eau verticaux, plus ou moins opaques : la nappe de la cascade (alphaMap lit le vert). */
function carteDeFilets(n = 64): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4)
  for (let x = 0; x < n; x++) {
    const filet = 0.7 + 0.3 * Math.sin(x * 0.45) * Math.sin(x * 0.19 + 1.3)
    for (let y = 0; y < n; y++) {
      const v = Math.max(0, Math.min(1, filet * (0.75 + 0.25 * Math.sin((y / n) * Math.PI * 6 + x))))
      data.set([v * 255, v * 255, v * 255, 255], (y * n + x) * 4)
    }
  }
  const t = new THREE.DataTexture(data, n, n)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.needsUpdate = true
  return t
}

/** Un bruit de valeur, pour les shaders du jardin. */
const BRUIT = `
float jHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float jBruit(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(jHash(i), jHash(i + vec2(1, 0)), u.x), mix(jHash(i + vec2(0, 1)), jHash(i + vec2(1, 1)), u.x), u.y);
}`

/** Le pied de la cascade dans l'étang (x, z), la direction de la chute (x, z), et sa demi-largeur. */
const CHUTE = (() => {
  const [[ax, az], [bx, bz, w]] = [TRACE_RUISSEAU[INDICE_LEVRE - 1], TRACE_RUISSEAU[INDICE_LEVRE]]
  const l = Math.hypot(bx - ax, bz - az)
  const [ux, uz] = [(bx - ax) / l, (bz - az) / l]
  const a = BOMBE_LEVRE + 0.19
  return { pied: new THREE.Vector4(bx + ux * a, bz + uz * a, ux, uz), demi: w / 2 + 0.25 }
})()

const CIEL_JOUR = new THREE.Color('#5d746c')
const CIEL_NUIT = new THREE.Color('#0b1224')

export interface MatieresJardin {
  eau: THREE.MeshStandardMaterial
  /** Le ruisseau : une eau claire qui COULE le long de son ruban (`rubanDuRuisseau`), écume aux radiers. */
  ruisseau: THREE.MeshStandardMaterial
  cascade: THREE.MeshStandardMaterial
  /** À chaque image : l'eau dérive, la cascade tombe, le reflet suit le ciel (`jour` ∈ [0, 1]). */
  animer: (t: number, jour: number) => void
  dispose: () => void
}

/** `remous` : là où le courant bute (`plan/ruisseau.ts`), l'eau du ruisseau écume. */
export function creerMatieresJardin(remous: Remous[] = []): MatieresJardin {
  const vaguelettes = carteDeVaguelettes()
  // Presque noire, verte en profondeur : c'est le reflet qui fait l'eau, pas sa couleur.
  const eau = new THREE.MeshStandardMaterial({
    name: 'jardin:eau',
    color: '#16291d',
    roughness: 0.1,
    metalness: 0.1,
    normalMap: vaguelettes,
    normalScale: new THREE.Vector2(0.14, 0.14),
    envMapIntensity: 0.45,
    // Translucide à la verticale : on voit les carpes sous la surface (`FauneLayer`).
    transparent: true,
  })
  // Le reflet du ciel, au rasant : `scene.environment` est un studio neutre, pas
  // le ciel du parc. Un terme de Fresnel qui tire l'eau vers la couleur du ciel
  // de l'heure — sombre sous les pieds, claire au loin, comme un vrai étang.
  const ciel = { value: CIEL_JOUR.clone() }
  const temps = { value: 0 }
  eau.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uCiel: ciel, uTempsE: temps, uPiedCascade: { value: CHUTE.pied } })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEtang;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vEtang = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uCiel;\nuniform float uTempsE;\nuniform vec4 uPiedCascade;\nvarying vec3 vEtang;\n${BRUIT}`)
      // Au pied de la cascade, l'eau tombée remonte en bulles : une écume qui
      // s'étale en éventail et se défait en fils vers le large.
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  vec2 eD = vEtang.xz - uPiedCascade.xy;
  float eAvant = dot(eD, uPiedCascade.zw), eTravers = dot(eD, vec2(-uPiedCascade.w, uPiedCascade.z));
  float eZone = (1.0 - smoothstep(0.1, 1.0, length(vec2(eAvant * 1.1, eTravers / ${CHUTE.demi.toFixed(2)})))) * step(-0.2, eAvant);
  float eFil = 1.0 - smoothstep(0.0, 0.045, abs(jBruit(vec2(eAvant * 1.5 - uTempsE * 1.0, eTravers * 16.0)) - 0.5));
  float eCoeur = (1.0 - smoothstep(0.0, 0.22, eAvant)) * smoothstep(0.62, 0.82, jBruit(vec2(eAvant * 26.0 - uTempsE * 2.0, eTravers * 26.0)));
  float eEcume = eZone * max(eFil * 0.6, eCoeur);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.87, 0.86), eEcume);`,
      )
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directSpecular *= 0.55;')
      .replace(
        '#include <opaque_fragment>',
        `float fresnel = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
         outgoingLight = mix(outgoingLight, uCiel, fresnel * 0.6);
         diffuseColor.a = max(mix(0.9, 1.0, fresnel), eEcume);
         #include <opaque_fragment>`,
      )
  }
  eau.customProgramCacheKey = () => 'jardin:eau'
  // Et les ronds de la pluie sur l'étang.
  rider(eau)

  const ruisseau = creerRuisseau(vaguelettes, ciel, temps, remous)

  const filets = carteDeFilets()
  const cascade = new THREE.MeshStandardMaterial({
    name: 'jardin:cascade',
    color: '#e8f2ee',
    roughness: 0.35,
    alphaMap: filets,
    transparent: true,
    opacity: 0.8,
    emissive: '#2c3634',
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  // UV de la nappe (build-jardin.py) : u en travers, de 0 à 1 ; v, les mètres
  // parcourus depuis la lèvre (0,31 au pied). Une eau sombre et vitreuse en haut,
  // rayée de filets clairs qui tombent, qui s'aère et blanchit en bas ; plus mince aux flancs.
  cascade.onBeforeCompile = (shader) => {
    shader.uniforms.uTempsC = temps
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCasc;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vCasc = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTempsC;\nvarying vec2 vCasc;\n${BRUIT}`)
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
  float cRaie = jBruit(vec2(vCasc.x * 55.0, vCasc.y * 5.0 - uTempsC * 2.6)) * 0.65 + jBruit(vec2(vCasc.x * 90.0, vCasc.y * 9.0 - uTempsC * 3.4)) * 0.35;
  float cBas = smoothstep(0.14, 0.3, vCasc.y);
  float cBulle = smoothstep(0.35, 0.7, jBruit(vec2(vCasc.x * 45.0, vCasc.y * 22.0 - uTempsC * 7.0)) + 0.3 * cBas) * cBas;
  float cFlanc = smoothstep(0.0, 0.16, vCasc.x) * smoothstep(1.0, 0.84, vCasc.x);
  float cClair = max(smoothstep(0.5, 0.8, cRaie), cBulle);
  diffuseColor.rgb *= mix(0.3, 1.0, cClair);
  diffuseColor.a = max(diffuseColor.a * mix(0.55, 1.0, cRaie), cBulle * 0.95) * mix(0.4, 1.0, cFlanc);`,
      )
  }
  cascade.customProgramCacheKey = () => 'jardin:cascade'
  return {
    eau,
    ruisseau,
    cascade,
    animer: (t, jour) => {
      temps.value = t
      ciel.value.copy(CIEL_NUIT).lerp(CIEL_JOUR, jour)
      vaguelettes.offset.set(t * 0.012, t * 0.007)
      filets.offset.set(0, t * 0.9)
    },
    dispose: () => {
      for (const m of [eau, ruisseau, cascade]) m.dispose()
      for (const t of [vaguelettes, filets]) t.dispose()
    },
  }
}

/**
 * L'eau du ruisseau, sur le ruban de `rubanDuRuisseau` : u le long du courant,
 * v en travers (mètres), et par sommet le radier (0..1) et la place en travers
 * (`aEau`). Deux couches de vaguelettes défilent vers l'aval à des vitesses
 * différentes, plus creusées aux radiers ; un bruit étiré dans le sens du
 * courant y blanchit l'écume, qui court aussi au pied des berges. Claire là où
 * elle est mince (on voit les galets du lit), sombre au creux des mouilles, et
 * le ciel au rasant comme l'étang. L'hiver, ses bords prennent en glace.
 * L'écume est posée AVANT l'éclairage (couleur, rugosité) : elle s'éteint la nuit
 * avec le reste.
 */
function creerRuisseau(vaguelettes: THREE.Texture, ciel: { value: THREE.Color }, temps: { value: number }, remous: Remous[]): THREE.MeshStandardMaterial {
  const obstacles = Array.from({ length: REMOUS_MAX }, (_, i) => new THREE.Vector4(...(remous[i] ?? [0, 0, 0, 0])))
  const m = new THREE.MeshStandardMaterial({
    name: 'jardin:ruisseau',
    color: '#ffffff',
    // Pas plus lisse : à 0,14, le soleil s'y brisait en mille étincelles blanches.
    roughness: 0.2,
    metalness: 0,
    normalMap: vaguelettes,
    normalScale: new THREE.Vector2(0.14, 0.14),
    envMapIntensity: 0.45,
    transparent: true,
  })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uCielR: ciel, uTempsR: temps, uGelR: INTEMPERIES.uEnneige, uRemous: { value: obstacles }, uNRemous: { value: remous.length } })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aEau;\nvarying vec2 vEau;\nvarying vec2 vFil;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvEau = aEau;\nvFil = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uCielR;
uniform float uTempsR;
uniform float uGelR;
uniform vec4 uRemous[${REMOUS_MAX}];
uniform int uNRemous;
varying vec2 vEau;
varying vec2 vFil;
float rHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float rBruit(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1, 0)), u.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), u.x), u.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  float rRadier = vEau.x;
  float rBord = vEau.y;
  // Le courant : le bruit défile vers l'aval, étiré dans son sens.
  vec2 rQ = vec2(vFil.x * 2.4 - uTempsR * 1.6, vFil.y * 6.5);
  float rN = rBruit(rQ) * 0.5 + rBruit(rQ * vec2(2.1, 2.6) + vec2(7.1, 3.7) - vec2(uTempsR * 1.1, 0.0)) * 0.32 + rBruit(rQ * 5.3 + 3.3) * 0.18;
  // Des taches d'écume qui naissent et se défont : un second bruit, lent, les module.
  float rNappe = rBruit(vec2(vFil.x * 0.7 - uTempsR * 0.5, vFil.y * 1.3 + 5.0));
  // L'écume en FILS : un bruit très étiré dans le sens du courant, fin en
  // travers, dont on ne garde qu'une ligne de niveau — des traits blancs de
  // quelques centimètres qui filent vers l'aval, coupés par un second bruit.
  // Pas de nappes : des taches mates d'un demi-mètre lisaient comme du plastique.
  float rOnde = 0.5 * rBruit(vec2(vFil.x * 0.45 - uTempsR * 0.4, vFil.y * 2.5));
  float rS1 = rBruit(vec2(vFil.x * 0.8 - uTempsR * 1.7, vFil.y * 15.0 + rOnde * 4.0));
  float rS2 = rBruit(vec2(vFil.x * 1.6 - uTempsR * 2.3 + 3.7, vFil.y * 27.0 + rOnde * 6.0 + 1.9));
  float rF = max(1.0 - smoothstep(0.0, 0.07, abs(rS1 - 0.5)), 0.75 * (1.0 - smoothstep(0.0, 0.05, abs(rS2 - 0.5))));
  rF *= smoothstep(0.3, 0.65, rBruit(vec2(vFil.x * 2.6 - uTempsR * 2.0, vFil.y * 7.0 + 2.3)));
  float rEcume = rF * rRadier * smoothstep(0.4, 0.8, rNappe + 0.15 * rRadier) * 0.4;
  rEcume = max(rEcume, rF * smoothstep(0.8, 1.05, rBord) * (0.25 + 0.3 * rRadier));
  // Les obstacles (souches, branche, galets qui affleurent, rochers) : un
  // bourrelet serré à l'amont, puis des fils blancs qui s'étirent vers l'aval.
  float rChoc = 0.0;
  float rCol = 0.0;
  for (int i = 0; i < ${REMOUS_MAX}; i++) {
    if (i >= uNRemous) break;
    vec4 o = uRemous[i];
    vec2 d = vFil - o.xy;
    float aval = max(d.x, 0.0);
    vec2 e = vec2(d.x / (o.z * (d.x > 0.0 ? 6.0 : 1.1)), d.y / (o.z * (1.0 + 0.25 * aval / o.z)));
    float k = (1.0 - smoothstep(0.3, 1.0, length(e))) * o.w;
    rChoc = max(rChoc, k * (1.0 - 0.5 * smoothstep(0.0, 6.0 * o.z, aval)));
    // Le collet : tout contre l'obstacle, l'eau se soulève en un bourrelet blanc.
    rCol = max(rCol, (1.0 - smoothstep(0.55, 1.0, length(d / (o.z * 0.75)))) * o.w);
  }
  rEcume = max(rEcume, rF * smoothstep(0.05, 0.5, rChoc));
  rEcume = max(rEcume, rCol * 0.8 * smoothstep(0.5, 0.8, rBruit(vec2(vFil.x * 14.0 - uTempsR * 3.0, vFil.y * 14.0)) + 0.15 * rCol));
  rRadier = max(rRadier, rChoc);
  // Profonde au milieu des mouilles, mince au bord et sur les radiers.
  float rProfond = (1.0 - smoothstep(0.25, 1.0, rBord)) * (1.0 - 0.55 * rRadier);
  float rGel = uGelR * smoothstep(0.8, 1.05, rBord + 0.15 * rN);
  diffuseColor.rgb = mix(vec3(0.07, 0.085, 0.06), vec3(0.015, 0.04, 0.03), rProfond);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.9), rEcume);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.86, 0.92), rGel);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(roughnessFactor, 0.26, rRadier), 0.75, max(rEcume, rGel * 0.4));')
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        `vec3 mapN1 = texture2D( normalMap, vec2( vFil.x * 0.55 - uTempsR * 0.32, vFil.y * 0.8 ) ).xyz * 2.0 - 1.0;
  vec3 mapN2 = texture2D( normalMap, vec2( vFil.x * 1.35 - uTempsR * 0.6 + 0.37, vFil.y * 1.6 + 0.21 ) ).xyz * 2.0 - 1.0;
  vec3 mapN = normalize( vec3( ( mapN1.xy + mapN2.xy ) * ( 0.5 + 0.8 * rRadier ) * ( 1.0 - rGel ), 1.0 ) );`,
        ),
      )
      // Le reflet du soleil presque éteint : sur une eau ridée, le lobe GGX s'étale
      // au rasant en nappes blanches d'un demi-mètre, découpées par l'ombre des
      // arbres — des bâches de plastique, pas de l'eau. Et le reflet de
      // l'environnement (les sondes, le studio) ne vaut qu'au rasant, en Fresnel :
      // l'eau reste sombre et transparente, l'écume seule y met du blanc.
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
  float rFr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 4.0);
  reflectedLight.directSpecular *= 0.03 * (1.0 - 0.8 * rEcume);
  reflectedLight.indirectSpecular *= mix(0.05, 0.45, rFr) * (1.0 - 0.8 * rEcume);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float rFresnel = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
         outgoingLight = mix(outgoingLight, uCielR, rFresnel * 0.35 * (1.0 - rEcume));
         // L'hiver, l'eau froide se fait sombre et opaque : la neige de la berge (intemperer) ne tapisse pas le lit.
         diffuseColor.a = max(mix(mix(0.38, 0.85, rProfond), 1.0, rFresnel), max(max(rEcume * 0.9, rGel), 0.92 * smoothstep(0.05, 0.35, uGelR)));
         #include <opaque_fragment>`,
      )
  }
  m.customProgramCacheKey = () => 'jardin:ruisseau'
  // Les ronds de la pluie, greffés après : `rider` enchaîne sur ce crochet.
  rider(m)
  return m
}

/**
 * Couvre de mousse le dessus d'un rocher : les textures Poly Haven sont d'une
 * pierre brune, et c'est la mousse, sur les faces tournées vers le ciel, qui
 * fait un rocher de jardin japonais. La pierre qui reste passe au gris.
 *
 * La normale lue est celle de l'OBJET : les rochers ne tournent qu'autour de la
 * verticale, sa composante y est donc celle du monde.
 */
export function mousser(m: THREE.Material): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vMousse;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvMousse = normalize(objectNormal).y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMousse;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
         vec3 pierre = mix(diffuseColor.rgb, vec3(lum) * vec3(0.92, 0.95, 0.9), 0.6);
         vec3 mousse = vec3(0.16, 0.24, 0.07) * (0.6 + 1.6 * lum);
         diffuseColor.rgb = mix(pierre, mousse, smoothstep(0.25, 0.75, vMousse + (lum - 0.3) * 0.8));`,
      )
  }
  m.customProgramCacheKey = () => 'jardin:mousse'
  m.needsUpdate = true
}

/**
 * UV « de boîte » en mètres, pour les pièces que Blender livre sans UV : chaque
 * face prend la projection du plan qui lui fait face. Assez pour qu'une
 * matière du musée (pierre, bois) s'y pose à la bonne échelle.
 */
export function uvBoite(g: THREE.BufferGeometry, echelle = 1): void {
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const [p, n] = [g.getAttribute('position'), g.getAttribute('normal')]
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const [ax, ay, az] = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))]
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]
    uv[2 * i] = u / echelle
    uv[2 * i + 1] = v / echelle
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** La berge fonce et verdit en descendant vers l'eau : la terre mouillée, la mousse. */
const BERGE = new THREE.Color('#4a5a2c')
/** Au fil de l'eau, le rebord de la berge : de la terre mouillée, presque noire. */
const TERRE = new THREE.Color('#3a3325')
/** Et sous l'eau, le lit : gravier et limon, brun-gris, que la nappe claire du ruisseau laisse voir. */
const LIT = new THREE.Color('#5e5644')

/**
 * Prépare le sol creusé pour la pelouse du parc : UV en mètres lues sur le plan
 * (comme les dalles de ParkLayer) et une couleur par sommet qui assombrit la
 * berge. Et l'eau : UV en mètres, pour que les vaguelettes aient partout la même taille.
 */
export function preparerSol(g: THREE.BufferGeometry, eau: boolean): void {
  const p = g.getAttribute('position')
  const uv = new Float32Array(p.count * 2)
  const couleur = new Float32Array(p.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
    ;[uv[2 * i], uv[2 * i + 1]] = eau ? [x / 3, z / 3] : [x, z]
    const t = (a: number, b: number) => Math.min(1, Math.max(0, (-y - a) / (b - a)))
    c.setRGB(1, 1, 1).lerp(BERGE, t(0.03, 0.12)).lerp(TERRE, t(0.1, 0.2)).lerp(LIT, t(0.22, 0.28))
    couleur.set([c.r, c.g, c.b], 3 * i)
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  if (!eau) g.setAttribute('color', new THREE.BufferAttribute(couleur, 3))
}

/**
 * Le soleil qui danse au fond du ruisseau : un réseau de filets clairs qui
 * ondulent sur le lit, là où l'eau est mince. Seulement sous le fil de l'eau du
 * ruisseau (la pelouse ne descend jamais sous −0,1 m hors de l'eau) ; il éclaire
 * la couleur avant la lumière, donc s'éteint à l'ombre et la nuit.
 * Greffé APRÈS `intemperer`, dont il reprend `vMonde` et `uTemps`.
 */
export function caustiques(m: THREE.Material): void {
  const avant = m.onBeforeCompile.bind(m)
  const cle = m.customProgramCacheKey()
  const n = JARDIN.ruisseau.niveau
  m.onBeforeCompile = (s, r) => {
    avant(s, r)
    s.fragmentShader = s.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    float cFond = smoothstep(${(n - 0.015).toFixed(3)}, ${(n - 0.05).toFixed(3)}, vMonde.y) * (1.0 - smoothstep(-0.36, -0.42, vMonde.y));
    if (cFond > 0.0) {
      vec2 cQ = vMonde.xz * 2.6;
      float cA = abs(sin(cQ.x + 1.3 * sin(cQ.y * 1.2 + uTemps * 0.9) + uTemps * 0.5));
      float cB = abs(sin(cQ.y * 1.1 + 1.4 * sin(cQ.x * 1.5 - uTemps * 0.7) - uTemps * 0.4));
      diffuseColor.rgb *= 1.0 + 0.45 * pow(1.0 - min(cA, cB), 9.0) * cFond;
    }
  }`,
    )
  }
  m.customProgramCacheKey = () => `${cle}|caustiques`
  m.needsUpdate = true
}
