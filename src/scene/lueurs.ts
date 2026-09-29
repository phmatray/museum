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
 * `LUEURS` est un objet ordinaire, pas un `Vector4` : three ne clone pas une
 * telle valeur d'uniforme, tous les matériaux éclairés partagent celle-ci.
 * Module importé avant toute compilation de matériau (par `NefLayer` et `Ciel`).
 */
import * as THREE from 'three'

export const LUEURS = { x: 0, y: 0, z: 0, w: 1 }

for (const lib of Object.values(THREE.ShaderLib)) if ('hemisphereLights' in lib.uniforms) lib.uniforms.uLueurs = { value: LUEURS }
THREE.ShaderChunk.lights_pars_begin += '\nuniform vec4 uLueurs;\n'
THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps.replace(
  '#if defined( RE_IndirectDiffuse )',
  `#if defined( RE_IndirectDiffuse )
  if (uLueurs.w < 1.0 || uLueurs.x + uLueurs.y + uLueurs.z > 0.0) {
    vec3 pLieu = (geometryPosition - viewMatrix[3].xyz) * mat3(viewMatrix);
    // Dedans : entre les faces extérieures (−0,45 / +0,45) et intérieures (±0,15) des façades.
    float dedans = smoothstep(-0.4, 0.1, pLieu.x) * (1.0 - smoothstep(47.9, 48.4, pLieu.x))
      * smoothstep(-0.4, 0.1, pLieu.z) * (1.0 - smoothstep(39.9, 40.4, pLieu.z));
    irradiance *= mix(uLueurs.w, 1.0, dedans);
    // Le hall, entre les faces de ses murs (±0,15).
    float nef = smoothstep(15.85, 16.15, pLieu.x) * (1.0 - smoothstep(31.85, 32.15, pLieu.x))
      * smoothstep(11.85, 12.15, pLieu.z) * (1.0 - smoothstep(39.85, 40.15, pLieu.z));
    irradiance += uLueurs.xyz * nef * (0.75 + 0.25 * inverseTransformDirection(geometryNormal, viewMatrix).y);
  }`,
)
