/**
 * Les matières qui ont vécu : la façade coulée sous ses saillies, éclaboussée
 * au pied, verdie au nord, ses pierres épaufrées aux arêtes ; le dallage et le
 * gravier usés au milieu, moussus dans les joints et sur les bords ; dedans,
 * discrètement, le terrazzo terni sur les lignes de passage et le pied des
 * plinthes encrassé. Le musée est bien tenu : dedans, on devine, on ne voit pas.
 *
 * Où, et combien, vient de la géométrie (`plan/usure.ts`, deux cartes et une
 * liste de segments) ; le shader n'ajoute que le grain. Des greffes
 * `onBeforeCompile` CHAÎNÉES (`greffer`, `intemperies.ts`) : posées AVANT
 * `intemperer`, la pluie et la neige passent par-dessus l'usure. Les uniformes
 * sont partagés : rien ne recompile quand le temps change.
 */
import * as THREE from 'three'

import { MUSEE } from '../plan/musee'
import { parkPlacements } from '../plan/park'
import { COTE_DALLAGE } from '../plan/relief'
import { SALISSURE, carteDesPassages, carteDesSalissures, passagesDuHall } from '../plan/usure'
import { avecMonde, greffer } from './intemperies'

type Shader = THREE.WebGLProgramParametersWithUniforms

let salissures: THREE.DataTexture | null = null
let passages: THREE.DataTexture | null = null

/** La façade dépliée (`carteDesSalissures`), calculée une fois, partagée par toutes ses matières. */
function carteFacade(): THREE.DataTexture {
  if (salissures) return salissures
  const c = carteDesSalissures(MUSEE)
  salissures = new THREE.DataTexture(c.data, c.nu, c.nv * 4, THREE.RGBAFormat)
  salissures.magFilter = THREE.LinearFilter
  salissures.minFilter = THREE.LinearMipmapLinearFilter
  salissures.generateMipmaps = true
  salissures.needsUpdate = true
  return salissures
}

/** Le sol du parc vu du ciel (`carteDesPassages`) : R le piétinement, G la mousse. */
function carteDuParc(): THREE.DataTexture {
  if (passages) return passages
  const c = carteDesPassages(parkPlacements(MUSEE), MUSEE)
  passages = new THREE.DataTexture(c.data, c.nx, c.nz, THREE.RGFormat)
  passages.magFilter = THREE.LinearFilter
  passages.minFilter = THREE.LinearFilter
  passages.needsUpdate = true
  return passages
}

const terrain = parkPlacements(MUSEE).terrain
const HALL = passagesDuHall(MUSEE)
const N_HALL = 8

/** Les uniformes de l'usure, partagés. Les cartes sont posées à la première compilation. */
export const USURE = {
  uSalissure: { value: null as THREE.Texture | null },
  uPassage: { value: null as THREE.Texture | null },
  uCadrePassage: { value: new THREE.Vector4(terrain.x, terrain.z, terrain.width, terrain.depth) },
  uPassagesHall: { value: Array.from({ length: N_HALL }, (_, i) => new THREE.Vector4(...(HALL[i] ?? [1e4, 1e4, 1e4, 1e4]))) },
}

const f = (x: number) => x.toFixed(4)

/** La position et la taille de la boîte (instances de `Boites`), en mètres, pour les arêtes. */
function avecBoite(s: Shader): void {
  if (s.vertexShader.includes('varying vec3 vBoite;')) return
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBoite;\nvarying vec3 vTailleB;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  #ifdef USE_INSTANCING
    vBoite = position * aTailleBoite;
    vTailleB = aTailleBoite;
  #else
    vBoite = position;
    vTailleB = vec3(1.0);
  #endif`,
    )
  s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBoite;\nvarying vec3 vTailleB;')
}

/**
 * Les arêtes épaufrées : la distance à l'arête la plus proche (la face rendue
 * est à distance nulle de son propre plan ; la deuxième plus petite est
 * l'arête), mordue par endroits d'un éclat de quelques centimètres. `force`
 * règle la taille des éclats : 1 dehors, bien moins dedans.
 */
const ECLATS = (force: number) => /* glsl */ `
  {
    vec3 uE = vTailleB * 0.5 - abs(vBoite);
    float uLo = min(uE.x, min(uE.y, uE.z));
    float uHi = max(uE.x, max(uE.y, uE.z));
    float uArete = uE.x + uE.y + uE.z - uLo - uHi;
    float uT = dot(vMonde, vec3(1.0, 0.83, 1.17));
    float uN = iBruit(vec2(uT * 9.0, 1.3)) * 0.5 + iBruit(vec2(uT * 27.0, 7.7)) * 0.3 + iBruit(vec2(uT * 71.0, 2.9)) * 0.2;
    float uLarge = ${f(force)} * (0.004 + 0.07 * pow(uN, 1.8));
    float uEclat = 1.0 - smoothstep(uLarge * 0.75, uLarge, uArete);
    // L'éclat : une cassure plus sombre, encrassée, liserée d'un fil clair ; l'arête intacte, émoussée, prend un peu la lumière.
    float uLisere = (1.0 - uEclat) * (1.0 - smoothstep(uLarge, uLarge + 0.004, uArete)) * step(0.006, uLarge);
    diffuseColor.rgb *= mix(1.0 + 0.06 * (1.0 - smoothstep(0.0, 0.008, uArete)) + 0.12 * uLisere, 0.68, uEclat);
    #ifdef STANDARD
      roughnessFactor = min(1.0, roughnessFactor + 0.1 * uEclat);
    #endif
  }`

/**
 * La façade : coulures, eau des angles, abri sous les saillies (la carte),
 * éclaboussures au pied, mousse au nord, poussière sur les dessus. `pierre`
 * ajoute les arêtes épaufrées et teinte les coulures en gris (sur le calcaire,
 * elles noircissent ; sur la brique, elles grisent).
 */
export function userFacade(m: THREE.Material, { pierre = false } = {}): void {
  const { u0, largeur, hauteur } = SALISSURE
  greffer(m, `usure:facade:${pierre ? 'pierre' : 'brique'}`, (s) => {
    avecMonde(s)
    avecBoite(s)
    USURE.uSalissure.value = carteFacade()
    Object.assign(s.uniforms, USURE)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uSalissure;')
      .replace(
        '#include <emissivemap_fragment>',
        `
  {
    vec3 uNw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float uVert = 1.0 - smoothstep(0.35, 0.65, abs(uNw.y));
    vec4 uD = vec4(-vMonde.z, vMonde.z - ${f(MUSEE.depth)}, -vMonde.x, vMonde.x - ${f(MUSEE.width)});
    float uM = max(max(uD.x, uD.y), max(uD.z, uD.w));
    if (uM > -0.02) {
      float uF = uM == uD.x ? 0.0 : (uM == uD.y ? 1.0 : (uM == uD.z ? 2.0 : 3.0));
      float uU = uF < 1.5 ? vMonde.x : vMonde.z;
      vec2 uUV = vec2((uU - ${f(u0)}) / ${f(largeur)}, (uF + clamp(vMonde.y / ${f(hauteur)}, 0.006, 0.994)) / 4.0);
      vec3 uS = texture2D(uSalissure, uUV).rgb;
      // Le fil des coulures : étiré en hauteur, chacune sa largeur, quelques-unes franches.
      float uFil = iBruit(vec2(uU * 26.0, vMonde.y * 0.8)) * 0.5 + iBruit(vec2(uU * 7.0, vMonde.y * 0.25)) * 0.35 + iBruit(vec2(uU * 61.0, vMonde.y * 1.5)) * 0.15;
      float uCoule = smoothstep(0.06, 0.55, uS.r * (0.15 + 1.6 * uFil * uFil)) * uVert;
      float uAngle = smoothstep(0.1, 0.75, uS.g * (0.5 + 1.0 * iBruit(vec2(uU * 8.0, vMonde.y * 0.45)))) * uVert;
      float uAbri = uS.b * uVert * (0.55 + 0.45 * iBruit(vec2(uU * 3.1, vMonde.y * 3.7)));
      vec3 uSale = ${pierre ? 'vec3(0.4, 0.39, 0.37)' : 'vec3(0.42, 0.4, 0.4)'};
      diffuseColor.rgb *= mix(vec3(1.0), uSale, clamp(uCoule * 0.85 + uAngle * 0.7 + uAbri * 0.45, 0.0, 0.9));
      #ifdef STANDARD
        // Sous l'averse, l'eau suit les coulures et les angles : ils luisent.
        roughnessFactor = mix(roughnessFactor, 0.22, uMouille * max(uCoule, uAngle) * 0.8);
      #endif
      // Le pied : la pluie rejaillit du parvis sur une quarantaine de centimètres.
      float uHaut = vMonde.y - ${f(COTE_DALLAGE)};
      float uBord = 0.24 + 0.12 * iBruit(vec2(uU * 2.3, 1.7)) + 0.07 * iBruit(vec2(uU * 13.0, 4.1));
      float uEclab = (1.0 - smoothstep(uBord - 0.14, uBord, uHaut)) * uVert * (0.6 + 0.4 * iBruit(vec2(uU * 19.0, vMonde.y * 23.0)));
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.6, 0.56, 0.5), uEclab);
      // Au nord, jamais au soleil : la mousse gagne le pied, et les dessus des appuis.
      float uNord = step(uF, 0.5);
      float uTache = smoothstep(0.45, 0.75, iBruit(vec2(uU * 3.3, vMonde.y * 4.1)) * 0.55 + iBruit(vec2(uU * 14.0, vMonde.y * 15.0)) * 0.3 + iBruit(vec2(uU * 47.0, vMonde.y * 47.0)) * 0.15);
      float uMonte = 0.12 + 0.35 * iBruit(vec2(uU * 1.3, 5.0));
      float uMousse = uNord * uTache * max((1.0 - smoothstep(0.0, uMonte, uHaut)) * uVert, smoothstep(0.6, 0.9, uNw.y) * 0.7);
      float uL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.23, 0.11) * (0.6 + 0.7 * uL), uMousse * 0.6);
      // Et le nord verdit d'un voile d'algues, plus haut que la mousse.
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 0.92, 0.8), uNord * uVert * (1.0 - smoothstep(0.2, 1.2, uHaut)) * 0.8);${pierre ? `
      // La patine du calcaire : des pans plus gris, d'autres plus chauds, à l'échelle des blocs.
      float uPat = iBruit(vec2(uU * 0.7, vMonde.y * 0.9) + uF * 13.0) * 0.6 + iBruit(vec2(uU * 2.6, vMonde.y * 3.1)) * 0.4;
      diffuseColor.rgb *= mix(vec3(0.84, 0.84, 0.83), vec3(1.03, 1.01, 0.97), uPat);` : ''}
      // Les dessus : la poussière et la suie que la pluie n'emporte pas tout à fait.
      float uDessus = smoothstep(0.6, 0.9, uNw.y) * (0.55 + 0.45 * iBruit(vec2(uU * 5.0, vMonde.y * 9.0 + uF)));
      diffuseColor.rgb *= 1.0 - 0.22 * uDessus;
    }
  }${pierre ? ECLATS(1) : ''}
  #include <emissivemap_fragment>`,
      )
  })
}

/**
 * Dedans, à peine : les arêtes des pierres du hall un peu marquées, et le pied
 * des plinthes et du parement encrassé sur deux ou trois centimètres, là où la
 * serpillière ne va pas tout à fait. Seulement les boîtes posées sur un plancher.
 */
export function userInterieur(m: THREE.Material, { eclats = true } = {}): void {
  const planchers = MUSEE.levels.map((l) => l.elevation)
  greffer(m, `usure:interieur:${eclats ? 'eclats' : 'pied'}`, (s) => {
    avecMonde(s)
    avecBoite(s)
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
  {
    vec3 uNw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float uDansBoite = vBoite.y + vTailleB.y * 0.5;
    float uFond = vMonde.y - uDansBoite;
    float uPose = 0.0;
    ${planchers.map((e) => `uPose = max(uPose, 1.0 - step(0.03, abs(uFond - ${f(e)})));`).join('\n    ')}
    float uVert = 1.0 - smoothstep(0.35, 0.65, abs(uNw.y));
    float uT = dot(vMonde.xz, vec2(1.0));
    float uPied = (1.0 - smoothstep(0.004, 0.028 + 0.012 * iBruit(vec2(uT * 4.0, 2.0)), uDansBoite)) * uPose * uVert;
    diffuseColor.rgb *= 1.0 - 0.2 * uPied;
  }${eclats ? ECLATS(0.3) : ''}
  #include <emissivemap_fragment>`,
    )
  })
}

/**
 * Le terrazzo du hall, terni sur les lignes de passage (`passagesDuHall`) : un
 * peu moins poli, un rien plus gris, sur un mètre de large. Rien au-delà du
 * rez-de-chaussée.
 */
export function userSolDuHall(m: THREE.Material): void {
  greffer(m, 'usure:hall', (s) => {
    avecMonde(s)
    Object.assign(s.uniforms, USURE)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uPassagesHall[${N_HALL}];`)
      .replace(
        '#include <emissivemap_fragment>',
        `
  if (vMonde.y < 0.1) {
    float uD = 1e4;
    for (int i = 0; i < ${N_HALL}; i++) {
      vec4 sg = uPassagesHall[i];
      vec2 ab = sg.zw - sg.xy;
      float t = clamp(dot(vMonde.xz - sg.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
      uD = min(uD, length(vMonde.xz - sg.xy - t * ab));
    }
    float uB = iBruit(vMonde.xz * 1.7) * 0.6 + iBruit(vMonde.xz * 6.0) * 0.4;
    float uUse = 1.0 - smoothstep(0.3, 1.2, uD + (uB - 0.5) * 0.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.89, 0.87), uUse);
    #ifdef STANDARD
      roughnessFactor = min(1.0, roughnessFactor + 0.16 * uUse);
    #endif
  }
  #include <emissivemap_fragment>`,
      )
  })
}

/**
 * Le sol du parc sous les pas (`carteDesPassages`) : le milieu des allées
 * foulé, plus sombre et tassé ; la mousse sur les bords et au nord du musée.
 * `joints` : le dallage de pierre (`pierre.ts`, blocs de 1,20 × 0,60 m en
 * joints croisés), où la mousse prend d'abord dans les joints.
 */
export function pietiner(m: THREE.Material, { joints = false } = {}): void {
  greffer(m, `usure:sol:${joints ? 'dalles' : 'gravier'}`, (s) => {
    avecMonde(s)
    USURE.uPassage.value = carteDuParc()
    Object.assign(s.uniforms, USURE)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uPassage;\nuniform vec4 uCadrePassage;')
      .replace(
        '#include <emissivemap_fragment>',
        `
  {
    vec2 uP = texture2D(uPassage, (vMonde.xz - uCadrePassage.xy) / uCadrePassage.zw).rg;
    float uB = iBruit(vMonde.xz * 2.1) * 0.55 + iBruit(vMonde.xz * 7.3) * 0.3 + iBruit(vMonde.xz * 23.0) * 0.15;
    // Le milieu foulé : la trace s'effiloche sur ses bords.
    float uPas = smoothstep(0.15, 0.75, uP.r + (uB - 0.5) * 0.45);
    float uL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    ${joints ? `
    float uMousse = 0.0;
    float uJoint = 0.0;
    float uDalle = 0.5;
    #ifdef USE_MAP
    {
      // Les joints du dallage, lus sur l'UV de sa carte (en mètres : x / 2,40, z / 1,20).
      vec2 uM = vMapUv * vec2(2.4, 1.2);
      float uRang = floor(uM.y / 0.6);
      float uDec = mod(uRang, 2.0) < 0.5 ? 0.6 : 0.0;
      float uFz = fract(uM.y / 0.6);
      float uFx = fract((uM.x - uDec) / 1.2);
      float uJz = min(uFz, 1.0 - uFz) * 0.6;
      float uJx = min(uFx, 1.0 - uFx) * 1.2;
      float uJ = min(uJz, uJx);
      float uCol = floor((uM.x - uDec) / 1.2);
      // Chaque dalle s'use à sa façon : l'une plus que sa voisine.
      uDalle = iHash(vec2(uCol, uRang) + 0.5);
      // Le joint lui-même, un tronçon par côté de dalle : la mousse le prend, ou pas.
      vec2 uTroncon = uJz < uJx ? vec2(uCol, floor(uM.y / 0.6 + 0.5)) : vec2(floor((uM.x - uDec) / 1.2 + 0.5), uRang + 300.0);
      float uPris = iHash(uTroncon * 1.37 + 11.0);
      // À l'ombre et contre le mur, la plupart des joints ; au soleil, quelques-uns.
      float uSeuil = 1.0 - 0.95 * uP.g;
      float uPlein = smoothstep(uSeuil, uSeuil + 0.3, uPris);
      // Et le long du joint, la mousse s'interrompt par touffes.
      float uLong = uJz < uJx ? uM.x : uM.y;
      float uTouffe = smoothstep(0.35, 0.65, iBruit(vec2(uLong * 7.0, uPris * 40.0)) * 0.7 + iBruit(vec2(uLong * 23.0, uPris * 9.0)) * 0.3);
      float uLarge = 0.005 + 0.02 * uPlein * uP.g;
      uJoint = 1.0 - smoothstep(0.004, 0.012, uJ);
      uMousse = (1.0 - smoothstep(uLarge * 0.5, uLarge, uJ)) * uPlein * uTouffe * smoothstep(0.08, 0.4, uP.g);
    }
    #endif
    // Foulé : la pierre ne fonce pas, elle se POLIT — un peu plus claire, plus lustrée au
    // milieu ; la crasse va aux bords de la trace et dans ses joints, que les semelles ne lavent pas.
    float uTache = iBruit(vMonde.xz * 1.3 + 3.0) * 0.6 + iBruit(vMonde.xz * 4.1) * 0.4;
    float uPoli = min(1.0, uPas * (0.55 + 0.3 * uDalle + 0.3 * uTache));
    float uBordTrace = smoothstep(0.05, 0.3, uP.r) * (1.0 - smoothstep(0.35, 0.7, uP.r)) * (0.5 + 0.5 * uTache);
    diffuseColor.rgb *= (1.0 + 0.05 * uPoli) * (1.0 - 0.1 * uBordTrace) * (1.0 - 0.28 * uJoint * smoothstep(0.1, 0.5, uP.r));
    #ifdef STANDARD
      roughnessFactor = max(0.3, roughnessFactor - 0.3 * uPoli);
    #endif
    // Et, où l'on ne marche jamais, du lichen par plaques sur la pierre même.
    float uLichen = smoothstep(0.62, 0.8, uB) * smoothstep(0.35, 0.8, uP.g);
    // La mousse des joints : vert-brun sombre, éteint, pas un néon.
    vec3 uVertMousse = mix(vec3(0.1, 0.11, 0.06), vec3(0.17, 0.19, 0.09), iBruit(vMonde.xz * 5.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, uVertMousse * (0.8 + 0.6 * uL), uMousse * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.84, 0.86, 0.78), uLichen * 0.45);`
      : `
    // Le gravier tassé : moins de cailloux clairs qui roulent, la terre qui affleure entre eux.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4 + 0.35 * uL) * vec3(0.92, 0.86, 0.76), uPas * 0.5) * (1.0 - 0.22 * uPas);
    #ifdef STANDARD
      roughnessFactor = max(0.5, roughnessFactor - 0.1 * uPas);
    #endif
    // Sur les bords qu'on ne foule pas, entre les cailloux, le vert qui prend.
    float uVert = smoothstep(0.45, 0.8, uP.g * (0.55 + 0.9 * uB)) * smoothstep(0.55, 0.25, uL);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.2, 0.07) * (0.6 + 1.2 * uL), uVert * 0.7);`}
  }
  #include <emissivemap_fragment>`,
      )
  })
}

/**
 * Le chaperon et les chapiteaux du mur d'enceinte, les pierres du belvédère : de la
 * mousse fine le long des arêtes et dans les joints des dessus, qui déborde de
 * quelques centimètres sur les faces, et des taches de lichen.
 */
export function mousserChaperon(m: THREE.Material): void {
  greffer(m, 'usure:chaperon', (s) => {
    avecMonde(s)
    avecBoite(s)
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
  {
    vec3 uNw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float uSousDessus = vTailleB.y * 0.5 - vBoite.y;
    float uB = iBruit(vMonde.xz * 3.1 + vMonde.y) * 0.6 + iBruit(vMonde.xz * 11.0 + vMonde.y * 3.0) * 0.4;
    float uDessus = smoothstep(0.6, 0.9, uNw.y);
    // La mousse prend là où l'eau s'attarde : le long des arêtes du dessus et dans
    // les joints des pierres (une tous les 60 cm le long de la boîte), jamais en
    // plaques sur le plat. Le grain est fin (quelques centimètres) : sur un
    // chaperon large, un bruit de 30 cm peignait des taches de camouflage.
    vec2 uBord = vTailleB.xz * 0.5 - abs(vBoite.xz);
    float uLong = vTailleB.x > vTailleB.z ? vBoite.x : vBoite.z;
    float uJoint = abs(fract(uLong / 0.6 + 0.5) - 0.5) * 0.6;
    float uNid = min(min(uBord.x, uBord.y), uJoint);
    float uGrain = iBruit(vMonde.xz * 19.0 + vMonde.y * 5.0) * 0.6 + iBruit(vMonde.xz * 47.0 - vMonde.y * 3.0) * 0.4;
    float uFrange = 0.012 + 0.05 * uGrain * smoothstep(0.3, 0.7, uB);
    float uSurLeDessus = (1.0 - smoothstep(uFrange * 0.5, uFrange, uNid)) * smoothstep(0.35, 0.55, uGrain);
    // Et quelques coussinets épars sur le plat, d'un ou deux centimètres.
    float uCoussin = smoothstep(0.78, 0.86, iBruit(vMonde.xz * 41.0 + 7.0)) * smoothstep(0.45, 0.7, uB);
    float uDeborde = (1.0 - smoothstep(0.0, 0.01 + 0.025 * uGrain, uSousDessus)) * (1.0 - uDessus) * smoothstep(0.4, 0.6, uGrain);
    float uMousse = max(uDessus * max(uSurLeDessus, uCoussin * 0.8), uDeborde * 0.8);
    float uL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    // Un vert sombre, brun dans ses creux : de la mousse, pas de la peinture.
    vec3 uVert = mix(vec3(0.06, 0.075, 0.03), vec3(0.14, 0.17, 0.06), uGrain);
    diffuseColor.rgb = mix(diffuseColor.rgb, uVert * (0.7 + 0.6 * uL), uMousse * 0.9);
    // Le lichen : des ronds pâles, gris-vert, sur les faces.
    float uLichen = smoothstep(0.78, 0.84, iBruit(vec2(dot(vMonde.xz, vec2(1.0)) * 9.0, vMonde.y * 9.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.64, 0.5), uLichen * 0.4 * (1.0 - uDessus));
    // Le dessous et les faces, sales : la pierre n'a jamais été lavée.
    diffuseColor.rgb *= 0.86 + 0.14 * uB;
  }${ECLATS(1)}
  #include <emissivemap_fragment>`,
    )
  })
}
