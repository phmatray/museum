/**
 * Les matières des galeries : la tenture des murs et le parquet à bâtons rompus.
 *
 * Les murs étaient un aplat de plâtre teinté, et le sol le même plancher à
 * lames droites que partout. Deux greffes `onBeforeCompile` CHAÎNÉES
 * (`greffer`, `intemperies.ts`), posées après les retouches de `materials.ts` :
 *
 * - la TENTURE : un tissu tendu, comme aux murs des salles de peinture. Une
 *   toile à armure simple qu'on ne devine que de près (elle s'efface avec la
 *   distance, avant de moirer), des fils flammés qui rayent le lé à mi-distance,
 *   et des nuances larges, comme une teinture jamais tout à fait égale ;
 * - le PARQUET À BÂTONS ROMPUS : des lames de 54 × 9 cm à 45°, alternées à
 *   angle droit. Chaque lame lit sa propre planche dans la carte du parquet (la
 *   carte a 16 planches en travers et des joints tous les quarts de tuile ; une
 *   lame n'en chevauche jamais), le fil du bois tourné avec elle — couleur,
 *   rugosité et normale —, sa teinte un peu plus claire ou plus sombre que sa
 *   voisine, et un joint fin qui s'efface au loin.
 *
 * La même moyenne d'albédo qu'avant : la lumière cuite reste juste.
 */
import * as THREE from 'three'

import { avecMonde, greffer } from './intemperies'

/** La lame : largeur (m) et longueur en largeurs. */
const LAME = { largeur: 0.09, rapport: 6 }
/** La carte du parquet couvre 3 m ; 16 planches en travers, un joint tous les quarts de tuile en long. */
const TUILE = 3

const f = (x: number) => x.toFixed(5)

const BATONS_GLSL = /* glsl */ `
vec2 btUv;
vec2 btDx;
vec2 btDy;
float btAngle;
float btTon;
float btJoint;
void btCalcul() {
  const float W = ${f(LAME.largeur)};
  const float N = ${f(LAME.rapport)};
  // Le repère des lames : tourné de 45°, en largeurs de lame.
  vec2 q = vec2(vMonde.x + vMonde.z, vMonde.z - vMonde.x) * 0.70710678 / W;
  vec2 dqx = dFdx(q);
  vec2 dqy = dFdy(q);
  // Une lame « couchée » occupe [k, k+N] × [k, k+1] ; une « debout » [k, k+1] × [k+1, k+1+N] ;
  // le motif se répète de (N, −N) : on ramène le point dans l'une ou l'autre.
  float hu = q.x - floor(q.y);
  float r = mod(hu, 2.0 * N);
  vec2 lame;
  vec2 id;
  bool debout = r >= N;
  if (!debout) {
    lame = vec2(r, fract(q.y));
    id = vec2(floor(q.y), floor(hu / (2.0 * N)));
  } else {
    float vv = q.y - floor(q.x) - 1.0;
    lame = vec2(mod(vv, 2.0 * N), fract(q.x));
    id = vec2(floor(q.x) + 517.0, floor(vv / (2.0 * N)));
  }
  vec3 h = fract(sin(vec3(dot(id, vec2(127.1, 311.7)), dot(id, vec2(269.5, 183.3)), dot(id, vec2(419.2, 371.9)))) * 43758.5453);
  // Sa planche dans la carte : une des 16 en travers, un des 4 quarts en long, loin des joints.
  vec2 m = lame * W;
  btUv = vec2(floor(h.x * 4.0) * 0.25 + 0.035 + m.x / ${f(TUILE)}, floor(h.y * 16.0) / 16.0 + 0.016 + m.y / ${f(TUILE)});
  btDx = (debout ? dqx.yx : dqx) * W / ${f(TUILE)};
  btDy = (debout ? dqy.yx : dqy) * W / ${f(TUILE)};
  // Le fil du bois : à 45° pour les couchées, à 135° pour les debout.
  btAngle = debout ? 2.3561945 : 0.7853982;
  btTon = 0.88 + 0.24 * h.z;
  // Le joint : un filet sombre au bord de la lame, fondu quand il devient plus fin qu'un pixel.
  float px = (length(dqx) + length(dqy)) * W;
  float bord = min(min(m.x, N * W - m.x), min(m.y, W - m.y));
  btJoint = 1.0 - 0.5 * (1.0 - smoothstep(0.0006, 0.0006 + px, bord)) * (1.0 - smoothstep(0.003, 0.012, px));
}
vec2 btTourne(vec2 v) {
  float c = cos(btAngle);
  float s = sin(btAngle);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}`

/** Remplace l'échantillonnage d'une carte (instanciée ou non) par celui de la lame. */
const echantillon = (glsl: string, carte: string, uv: string) =>
  glsl
    .replaceAll(`texRetouche( ${carte}, ${uv} )`, `textureGrad( ${carte}, btUv, btDx, btDy )`)
    .replaceAll(`texture2D( ${carte}, ${uv} )`, `textureGrad( ${carte}, btUv, btDx, btDy )`)

/** Le parquet des galeries, posé à bâtons rompus. */
export function batonsRompus(m: THREE.Material): void {
  greffer(m, 'galeries:batons', (s) => {
    avecMonde(s)
    // Juste avant `main` : après `vMonde`, que `avecMonde` déclare derrière `<common>`.
    let g = s.fragmentShader.replace('void main() {', `${BATONS_GLSL}\nvoid main() {\n  btCalcul();`)
    g = echantillon(g, 'map', 'vMapUv')
    g = echantillon(g, 'roughnessMap', 'vRoughnessMapUv')
    g = echantillon(g, 'normalMap', 'vNormalMapUv')
    s.fragmentShader = g
      .replace('diffuseColor *= sampledDiffuseColor;', 'diffuseColor *= sampledDiffuseColor;\n  diffuseColor.rgb *= btTon * btJoint;')
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale;\n  mapN.xy = btTourne(mapN.xy);')
  })
}

const TENTURE_GLSL = /* glsl */ `
  {
    // Sur le mur : le long du lé (x ou z, un seul varie sur une face), et la hauteur.
    vec2 tP = vec2(vMonde.x + vMonde.z, vMonde.y);
    float tPx = length(fwidth(tP));
    // L'armure : un fil sur deux passe dessus, 2,5 mm de pas ; effacée avant de moirer.
    vec2 tG = tP / 0.0025;
    vec2 tF = fract(tG) - 0.5;
    float tDessus = mod(floor(tG.x) + floor(tG.y), 2.0);
    float tFil = tDessus > 0.5 ? 1.0 - 4.0 * tF.y * tF.y : 1.0 - 4.0 * tF.x * tF.x;
    float tPres = 1.0 - smoothstep(0.0006, 0.0018, tPx);
    // Les fils flammés : de fines rayures horizontales, irrégulières, à mi-distance.
    float tFlamme = iBruit(vec2(tP.x * 0.8, tP.y * 140.0)) - 0.5;
    float tMi = 1.0 - smoothstep(0.004, 0.02, tPx);
    // La teinture : des nuances larges, lé par lé (un lé de 1,30 m).
    float tLe = iHash(vec2(floor(tP.x / 1.3), 4.1)) - 0.5;
    float tNuance = iBruit(tP * 0.9) * 0.6 + iBruit(tP * 3.1) * 0.4 - 0.5;
    diffuseColor.rgb *= 1.0 + 0.12 * tPres * (tFil - 0.66) + 0.08 * tMi * tFlamme + 0.06 * tLe + 0.16 * tNuance;
    #ifdef STANDARD
      roughnessFactor = min(1.0, roughnessFactor + 0.08 * tPres * (0.66 - tFil));
    #endif
  }`

/** Les murs des galeries, tendus de tissu. */
export function tendre(m: THREE.Material): void {
  greffer(m, 'galeries:tenture', (s) => {
    avecMonde(s)
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `${TENTURE_GLSL}\n  #include <emissivemap_fragment>`)
  })
}
