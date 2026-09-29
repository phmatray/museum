/**
 * La lumière précalculée, côté scène : l'atlas cuit par Blender
 * (`tools/blender/bake-lumiere.py`, `npm run bake`) relu sur les Boites du plan.
 *
 * L'atlas contient l'éclairement DIFFUS du ciel couvert — direct et rebonds —
 * sur chaque face visible du bâtiment : le coin sombre, le mur qui s'éclaire
 * sous un lanterneau, le sol de la nef sous sa verrière, l'ombre douce d'une
 * banquette. On en fait le facteur de l'éclairage AMBIANT (l'hémisphérique ;
 * l'environnement ne sert qu'au spéculaire, voir `RefletsLayer`) : l'hémisphérique suppose un ciel entier au-dessus de
 * chaque point, la cuisson dit combien il en voit vraiment. Les lumières
 * directes — le soleil, la lampe, les projecteurs — restent en temps réel.
 *
 * Une Boite retrouve ses rectangles par sa clé (`plan/lumiere.ts`) : un attribut
 * d'instance, `aLumiere`, porte son rang dans une petite table flottante (six
 * rectangles par rang, un par face). Rang 0 : pas de lumière cuite, facteur 1 —
 * c'est aussi ce que lit un maillage qui n'a pas l'attribut.
 */
import * as THREE from 'three'

import type { Box } from '../plan/mesh'
import { cleDeBoite } from '../plan/lumiere'
import LUMIERE_JSON from '../plan/lumiere.json' with { type: 'json' }

/** L'éclairement encodé : 1 dans l'atlas vaut PLAFOND. Même constante dans `bake-lumiere.py`. */
const PLAFOND = 2
/**
 * L'éclairement cuit qui vaut « l'ambiance d'avant ». Mesuré sur l'atlas : le
 * parquet d'une galerie, sous son lanterneau, en reçoit ~0,55 ; ses murs ~0,15 ;
 * un coin, moins de 0,05. Le facteur d'ambiance est (cuit / REFERENCE)^CONTRASTE :
 * la pleine proportion rendait les murs de galerie trois fois plus sombres que
 * leur sol — juste en lux, mais l'œil s'y adapte et l'écran non.
 */
export const REFERENCE = 0.45
export const CONTRASTE = 0.75

interface Donnees {
  largeur: number
  hauteur: number
  boites: Record<string, (number[] | 0)[]>
}
const DONNEES = LUMIERE_JSON as Donnees
const CLES = Object.keys(DONNEES.boites)
const RANG = new Map(CLES.map((c, i) => [c, i + 1]))

function creerTable(): THREE.DataTexture {
  const t = new Float32Array(6 * 4 * (CLES.length + 1))
  CLES.forEach((c, i) =>
    DONNEES.boites[c].forEach((r, f) => {
      if (r === 0) return
      t.set([r[0] / DONNEES.largeur, r[1] / DONNEES.hauteur, r[2] / DONNEES.largeur, r[3] / DONNEES.hauteur], ((i + 1) * 6 + f) * 4)
    }),
  )
  const tex = new THREE.DataTexture(t, 6, CLES.length + 1, THREE.RGBAFormat, THREE.FloatType)
  tex.needsUpdate = true
  return tex
}

/** Partagés par tous les matériaux : l'atlas arrive une fois, pour tous. */
export const LUMIERE = {
  uLumiereTable: { value: creerTable() },
  uLumiereAtlas: { value: null as THREE.Texture | null },
  /** 0 tant que l'atlas n'est pas là : le shader rend alors l'ambiance d'avant. */
  uLumiereForce: { value: 0 },
  uLumiereEchelle: { value: PLAFOND / REFERENCE },
  uLumiereContraste: { value: CONTRASTE },
}

/** Le rang de chaque boîte dans la table, 0 si elle n'a pas été cuite. */
export function rangsDeLumiere(boites: readonly Box[]): Float32Array {
  return new Float32Array(boites.map((b) => RANG.get(cleDeBoite(b)) ?? 0))
}

/**
 * Pose la lumière cuite sur un matériau de Boites. Chaîne sur
 * `onBeforeCompile`, comme `appliquerEchelleInstance` qui l'appelle.
 */
export function appliquerLumiere(material: THREE.Material): void {
  const precedent = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    precedent.call(material, shader, renderer)
    Object.assign(shader.uniforms, LUMIERE)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vLumiere;
         #ifdef USE_INSTANCING
         attribute float aLumiere;
         uniform highp sampler2D uLumiereTable;
         #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vLumiere = vec3(0.0);
         #ifdef USE_INSTANCING
         if (aLumiere > 0.5) {
           // La face se lit sur la normale du cube unité ; (s, t) comme coordonneesDeFace.
           vec3 n = normal;
           int face = abs(n.x) > 0.5 ? (n.x > 0.0 ? 0 : 1) : abs(n.y) > 0.5 ? (n.y > 0.0 ? 2 : 3) : (n.z > 0.0 ? 4 : 5);
           vec4 r = texelFetch(uLumiereTable, ivec2(face, int(aLumiere + 0.5)), 0);
           vec3 p = position + 0.5;
           vec2 st = face < 2 ? p.zy : face < 4 ? p.xz : p.xy;
           vLumiere = vec3(mix(r.xy, r.zw, st), r.z > 0.0 ? 1.0 : 0.0);
         }
         #endif`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vLumiere;
         uniform sampler2D uLumiereAtlas;
         uniform float uLumiereForce;
         uniform float uLumiereEchelle;
         uniform float uLumiereContraste;`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
         if (vLumiere.z > 0.5 && uLumiereForce > 0.0) {
           vec3 cuit = pow(texture2D(uLumiereAtlas, vLumiere.xy).rgb * uLumiereEchelle, vec3(uLumiereContraste));
           vec3 f = mix(vec3(1.0), cuit, uLumiereForce);
           reflectedLight.indirectDiffuse *= f;
           // Un coin qui ne voit pas le ciel ne le reflète pas non plus.
           reflectedLight.indirectSpecular *= min(f, vec3(1.0));
         }`,
      )
  }
}
