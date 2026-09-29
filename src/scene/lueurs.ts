/**
 * La lumière de nuit attachée aux LIEUX, pas au regard.
 *
 * Les sondes de reflets éclairaient autrefois le diffus (voir `RefletsLayer`) :
 * celle de la nef, pleine de lanternes, dorait le hall la nuit — mais elle
 * dorait tout ce que voyait le visiteur debout dans le hall, galeries
 * comprises, et plus rien dès qu'il en sortait : la clarté sautait aux portes.
 * Ce qui en reste ici dépend de la position du FRAGMENT éclairé, jamais de
 * celle du visiteur :
 *
 * - `x, y, z` : la lueur des lanternes (couleur × force), ajoutée à l'ambiance
 *   des surfaces situées entre les murs du hall (x 16–32, z 12–40), fondue sur
 *   l'épaisseur des murs. Réglée par `NefLayer`.
 * - `w` : le facteur de l'ambiance DEHORS (hors de l'emprise du bâtiment,
 *   fondu sur l'épaisseur des façades). L'hémisphérique de nuit a dû monter
 *   pour les salles ; le parc, lui, n'avait rien perdu. Réglé par `Ciel`.
 *
 * Les deux s'ajoutent à l'ambiance avant la lumière cuite (`lumiere.ts`), qui
 * les assombrit dans les coins comme le reste.
 *
 * `LAMPES` ajoute l'éclairage artificiel (`plan/eclairage.ts`), écrit en
 * constantes dans le shader — pas une seule vraie lumière de three :
 *
 * - `x` : la force des lampadaires du parc, la nuit. Dehors, chaque fragment
 *   additionne la flaque des globes à moins de `RAYON_LAMPADAIRE`, en
 *   Lambert adouci : le gravier sous le globe, le tronc voisin, la brique
 *   de la façade prennent la lumière de leur côté ; et, en pinceaux étroits, les
 *   projecteurs au pied de la façade sud. Réglé par `EclairageLayer`.
 * - `y` : la force des spots sous les balcons de la nef. Sous la dalle des
 *   balcons seulement, un cône vers le bas : chaque spot lave le mur d'un
 *   arc chaud qui s'éteint vers le sol. Réglé par `EclairageLayer` aussi.
 *
 * Chaque boucle ne tourne que là où elle peut éclairer (dehors la nuit, sous
 * les balcons) : le reste des fragments ne paie qu'un test.
 *
 * `LUEURS` est un objet ordinaire, pas un `Vector4` : three ne clone pas une
 * telle valeur d'uniforme, tous les matériaux éclairés partagent celle-ci.
 * Module importé avant toute compilation de matériau (par `NefLayer`, `Ciel`, `MobilierLayer`).
 */
import * as THREE from 'three'

import { PROJECTEURS_FACADE, SOURCES_LAMPADAIRES, SOUS_BALCON, SPOTS_BALCON } from '../plan/eclairage'

export const LUEURS = { x: 0, y: 0, z: 0, w: 1 }
export const LAMPES = { x: 0, y: 0, z: 0, w: 0 }

/** La portée d'un globe de lampadaire, et celle d'un spot sous balcon, en mètres. */
const RAYON_LAMPADAIRE = 7
const RAYON_SPOT = 5.2
/** Le projecteur de façade porte plus haut que le spot, et plus fort : la brique boit la lumière. */
const RAYON_FACADE = 14
const FORCE_FACADE = 3
/** 2 700 K, en linéaire : le blanc chaud d'une ampoule à filament. */
const CHAUD = new THREE.Color('#ffb46b')

const glsl = (v: number) => v.toFixed(3)
const CHAUD_GLSL = `vec3(${[CHAUD.r, CHAUD.g, CHAUD.b].map(glsl).join(', ')})`
const tableau = (nom: string, pts: [number, number, number][]) =>
  `const vec3 ${nom}[${pts.length}] = vec3[${pts.length}](${pts.map((p) => `vec3(${p.map(glsl).join(', ')})`).join(', ')});`

for (const lib of Object.values(THREE.ShaderLib)) {
  if ('hemisphereLights' in lib.uniforms) Object.assign(lib.uniforms, { uLueurs: { value: LUEURS }, uLampes: { value: LAMPES } })
}
THREE.ShaderChunk.lights_pars_begin += `
uniform vec4 uLueurs;
uniform vec4 uLampes;
${tableau('LAMPADAIRES', SOURCES_LAMPADAIRES)}
${tableau('SPOTS_BALCON', SPOTS_BALCON)}
${tableau('PROJECTEURS_FACADE', PROJECTEURS_FACADE)}
// Un cône de lumière : d va du fragment à la source ; axe vaut 1 pour une source au-dessus,
// -1 au-dessous ; rasant, de 0 à 1, relève la lumière qui frappe le mur en biais (un projecteur
// de façade est incliné vers la brique, pas tourné vers le ciel).
float lueurCone(vec3 d, vec3 n, float rayon, float axe, float c0, float c1, float rasant) {
  float l2 = dot(d, d);
  if (l2 >= rayon * rayon) return 0.0;
  float l = sqrt(l2);
  float a = 1.0 - l / rayon;
  float lambert = max(dot(n, d) / l, 0.0);
  return a * a * smoothstep(c0, c1, axe * d.y / l) * mix(lambert, min(1.0, 4.0 * lambert), rasant);
}
`
THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps.replace(
  '#if defined( RE_IndirectDiffuse )',
  `#if defined( RE_IndirectDiffuse )
  if (uLueurs.w < 1.0 || uLueurs.x + uLueurs.y + uLueurs.z > 0.0 || uLampes.x > 0.0) {
    vec3 pLieu = (geometryPosition - viewMatrix[3].xyz) * mat3(viewMatrix);
    vec3 nLieu = inverseTransformDirection(geometryNormal, viewMatrix);
    // Dedans : entre les faces extérieures (−0,45 / +0,45) et intérieures (±0,15) des façades.
    float dedans = smoothstep(-0.4, 0.1, pLieu.x) * (1.0 - smoothstep(47.9, 48.4, pLieu.x))
      * smoothstep(-0.4, 0.1, pLieu.z) * (1.0 - smoothstep(39.9, 40.4, pLieu.z));
    irradiance *= mix(uLueurs.w, 1.0, dedans);
    // Le hall, entre les faces de ses murs (±0,15).
    float nef = smoothstep(15.85, 16.15, pLieu.x) * (1.0 - smoothstep(31.85, 32.15, pLieu.x))
      * smoothstep(11.85, 12.15, pLieu.z) * (1.0 - smoothstep(39.85, 40.15, pLieu.z));
    irradiance += uLueurs.xyz * nef * (0.75 + 0.25 * nLieu.y);
    // Les lampadaires, dehors : la flaque de chaque globe, adoucie jusqu'à sa portée.
    if (uLampes.x > 0.0 && dedans < 0.99) {
      float f = 0.0;
      for (int i = 0; i < ${SOURCES_LAMPADAIRES.length}; i++) {
        vec3 d = LAMPADAIRES[i] - pLieu;
        float l2 = dot(d, d);
        if (l2 < ${glsl(RAYON_LAMPADAIRE ** 2)}) {
          float l = sqrt(l2);
          float a = 1.0 - l / ${glsl(RAYON_LAMPADAIRE)};
          f += a * a * (0.25 + 0.75 * max(dot(nLieu, d) / l, 0.0));
        }
      }
      // Les projecteurs de la façade sud : un pinceau étroit vers le haut, contre la brique.
      if (pLieu.z > 39.9 && pLieu.z < 43.0) {
        for (int i = 0; i < ${PROJECTEURS_FACADE.length}; i++) f += ${glsl(FORCE_FACADE)} * lueurCone(PROJECTEURS_FACADE[i] - pLieu, nLieu, ${glsl(RAYON_FACADE)}, -1.0, 0.8, 0.97, 1.0);
      }
      irradiance += ${CHAUD_GLSL} * (uLampes.x * f * (1.0 - dedans));
    }
  }
  // Les spots sous les balcons, de jour comme de nuit : sous la dalle, le long
  // des murs qu'ils lavent (le cône n'atteint pas 4,50 m de l'aplomb).
  if (uLampes.y > 0.0) {
    vec3 pLieu = (geometryPosition - viewMatrix[3].xyz) * mat3(viewMatrix);
    if (pLieu.y < ${glsl(SOUS_BALCON)} && pLieu.x > 16.0 && pLieu.x < 32.0 && pLieu.z > 16.5 && pLieu.z < 40.0
      && (pLieu.x < 21.5 || pLieu.x > 26.5 || pLieu.z > 34.5)) {
      vec3 nLieu = inverseTransformDirection(geometryNormal, viewMatrix);
      float f = 0.0;
      for (int i = 0; i < ${SPOTS_BALCON.length}; i++) f += lueurCone(SPOTS_BALCON[i] - pLieu, nLieu, ${glsl(RAYON_SPOT)}, 1.0, 0.5, 0.85, 0.0);
      irradiance += ${CHAUD_GLSL} * (uLampes.y * f);
    }
  }`,
)
