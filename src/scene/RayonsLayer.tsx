/**
 * L'air de la nef sous la verrière : une brume légère, les rayons du soleil qui
 * tombent des vitres (`plan/rayons.ts`) et la poussière qui danse dedans.
 *
 * Trois appels de dessin, aucun rendu en plus :
 *
 * - LA BRUME est une boîte à l'intérieur de la nef, dont on ne dessine que les
 *   faces du fond : chaque pixel calcule la longueur de nef que traverse son
 *   regard et s'y voile d'autant — la voûte au fond s'estompe, un banc à deux
 *   mètres non. C'est une brume LOCALE : `scene.fog` reste à la météo.
 * - LES RAYONS sont des prismes, un par panneau de la verrière, tirés dans la
 *   direction du soleil jusqu'au sol, en mélange additif. Chaque pixel s'éclaire
 *   de la longueur de faisceau que traverse son regard (voir plus bas), bornée
 *   à la nef ; la poussière les strie, et ils brillent davantage quand on
 *   regarde vers le soleil, comme dans l'air réel.
 * - LA POUSSIÈRE : quelques centaines de points qui dérivent, allumés seulement
 *   quand ils sont dans un faisceau.
 *
 * Les rayons ne sont là qu'en plein jour, soleil assez haut, et s'effacent sous
 * les nuages et dans le brouillard (`forceDesRayons`). Sous
 * `prefers-reduced-motion`, la poussière et les stries ne bougent plus.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { directionDuSoleil } from '../domain/soleil'
import { MUSEE } from '../plan/musee'
import { forceDesRayons, nefDuPlan, vitres, type Vitre } from '../plan/rayons'
import { plafonds } from '../plan/plafonds'
import { useGameStore } from '../stores/gameStore'
import { SOLEIL } from './lighting'
import { useCalme } from '../stores/reglagesStore'

const NEF = nefDuPlan(MUSEE)
const VITRES = vitres(NEF)
/** L'intérieur de la nef, jusqu'à la clé de voûte, un rien en retrait des murs ; sous le sol, pour que les faisceaux y finissent. */
const MIN = new THREE.Vector3(NEF.x + 0.15, -0.1, NEF.z + 0.15)
const MAX = new THREE.Vector3(NEF.x + NEF.width - 0.15, NEF.naissance + NEF.rayon, NEF.z + NEF.depth - 0.15)
const POUSSIERES = 700

/**
 * Les faisceaux : ceux de la verrière, bornés à la nef, et ceux des
 * lanterneaux de l'étage, bornés à leur salle. Le verre des lanterneaux est
 * dépoli : leur lumière est une colonne DOUCE (`doux`), sans stries.
 */
interface Faisceau { vitre: Vitre; min: THREE.Vector3; max: THREE.Vector3; doux: number }
const ETAGE = MUSEE.levels[MUSEE.levels.length - 1]
const FAISCEAUX: Faisceau[] = [
  ...VITRES.map((vitre) => ({ vitre, min: MIN, max: MAX, doux: 0 })),
  ...plafonds(MUSEE, ETAGE.id).verre.flatMap((b) => {
    const salle = ETAGE.rooms.find((r) => b.x > r.x && b.x < r.x + r.width && b.z > r.z && b.z < r.z + r.depth)
    if (!salle) return []
    return [{
      vitre: { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y: b.y },
      min: new THREE.Vector3(salle.x + 0.15, ETAGE.elevation, salle.z + 0.15),
      max: new THREE.Vector3(salle.x + salle.width - 0.15, b.y + 0.05, salle.z + salle.depth - 0.15),
      doux: 1,
    }]
  }),
]

const BRUIT = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float bruit(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`

const uniformes = {
  uForce: { value: 0 },
  uJour: { value: 1 },
  uSoleil: { value: new THREE.Vector3(0, 1, 0) },
  uCouleur: { value: new THREE.Color(SOLEIL.couleur) },
  uTemps: { value: 0 },
  uMin: { value: MIN },
  uMax: { value: MAX },
  uTaille: { value: 400 },
}

// ── Les rayons ───────────────────────────────────────────────────────────

/*
  Chaque faisceau est un prisme : le rectangle de sa vitre, balayé le long du
  soleil jusqu'au sol. Un pixel du prisme ne peint pas « une face » : il calcule
  la LONGUEUR de faisceau que traverse le regard (entrée, sortie, bornées par la
  nef) et s'éclaire d'autant. Les bords se fondent d'eux-mêmes — la corde y tend
  vers zéro — et dix faisceaux alignés ne s'empilent pas en vingt faces.

  Dans le repère de la vitre, un point p se projette sur la verrière en
  p.xz + k (Y − p.y), avec k = soleil.xz / soleil.y : c'est linéaire, et le
  regard reste une droite. D'où une intersection de boîte ordinaire.

  Un seul pixel par faisceau doit peindre : celui de la face par où le regard
  ENTRE (ou, si l'œil est dedans, celui par où il sort). Décidé à la distance,
  pas au sens des faces, qui dépend de l'ordre des sommets.
*/
const RAYON_VERT = /* glsl */ `
  attribute vec4 aVitre;
  attribute float aY;
  attribute vec4 aMin;
  attribute vec3 aMax;
  varying vec3 vMonde;
  varying vec4 vVitre;
  varying float vY;
  varying vec4 vMin;
  varying vec3 vMax;
  void main() {
    vMonde = position;
    vVitre = aVitre;
    vY = aY;
    vMin = aMin;
    vMax = aMax;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`
const RAYON_FRAG = /* glsl */ `
  uniform float uForce;
  uniform float uJour;
  uniform vec3 uSoleil;
  uniform vec3 uCouleur;
  uniform float uTemps;
  varying vec3 vMonde;
  varying vec4 vVitre;
  varying float vY;
  // La salle qui borne le faisceau (la nef, ou une salle de l'étage), et w : verre dépoli.
  varying vec4 vMin;
  varying vec3 vMax;
  ${BRUIT}
  // L'intervalle [entrée, sortie] de la droite o + t v dans la tranche [a, b] d'un axe où la droite avance de dv.
  vec2 tranche(float o, float dv, float a, float b) {
    float inv = 1.0 / (abs(dv) < 1e-5 ? (dv < 0.0 ? -1e-5 : 1e-5) : dv);
    float t0 = (a - o) * inv;
    float t1 = (b - o) * inv;
    return vec2(min(t0, t1), max(t0, t1));
  }
  vec2 inter(vec2 a, vec2 b) { return vec2(max(a.x, b.x), min(a.y, b.y)); }
  void main() {
    vec3 o = cameraPosition;
    vec3 r = vMonde - o;
    float ici = length(r);
    vec3 v = r / ici;
    // Sous le verre dépoli, la lumière ne vient plus du soleil : elle tombe droit.
    vec2 k = (1.0 - vMin.w) * uSoleil.xz / uSoleil.y;
    vec2 p0 = o.xz + k * (vY - o.y);
    vec2 pv = v.xz - k * v.y;
    vec2 prisme = inter(inter(tranche(p0.x, pv.x, vVitre.x, vVitre.y), tranche(p0.y, pv.y, vVitre.z, vVitre.w)), tranche(o.y, v.y, vMin.y, vY));
    prisme.x = max(prisme.x, 0.0);
    if (prisme.y <= prisme.x) discard;
    // Ce qui sort de la nef ne compte pas : le prisme, tiré en biais, déborde
    // des murs (dans la salle d'honneur, les galeries) quand le soleil est bas.
    vec2 nef = inter(inter(tranche(o.x, v.x, vMin.x, vMax.x), tranche(o.y, v.y, vMin.y, vMax.y)), tranche(o.z, v.z, vMin.z, vMax.z));
    vec2 corde = inter(prisme, nef);
    float l = corde.y - corde.x;
    if (l <= 0.0) discard;
    // Le pixel peint est celui de la face d'entrée — ou de sortie si l'œil est
    // dans le faisceau, ou si l'entrée est hors de la nef : derrière un mur, la
    // face d'entrée ne serait pas masquée par lui, et le faisceau de la nef
    // s'afficherait sur le plafond ou le mur d'une salle voisine.
    bool entree = prisme.x > 0.01 && prisme.x >= nef.x - 0.02;
    float face = entree ? prisme.x : prisme.y;
    if (!entree && prisme.y > nef.y + 0.02) discard;
    if (abs(ici - face) > 0.05 * max(1.0, face * 0.05)) discard;
    vec3 milieu = o + v * (0.5 * (corde.x + corde.y));
    // Naît sous la vitre, s'amenuise vers le sol.
    float trajet = smoothstep(vY, vY - 2.0, milieu.y) * mix(0.45, 1.0, smoothstep(vMin.y, vMin.y + 8.0, milieu.y));
    // Les stries de poussière, dans l'axe du faisceau.
    vec3 q = milieu - uSoleil * dot(milieu, uSoleil);
    float stries = 0.15 + 1.5 * smoothstep(0.3, 0.8, bruit(q * 0.9 + vec3(0.0, uTemps * 0.03, uTemps * 0.02))) * (0.7 + 0.3 * bruit(q * 4.0 - uTemps * 0.05));
    // Sous le verre dépoli, la lumière est déjà diffuse : un voile égal, à peine remué, plus pâle.
    // Des colonnes verticales, qui s'éteignent à mi-hauteur : la lumière coule du plafond et se perd dans l'air.
    float colonnes = smoothstep(0.4, 0.8, bruit(vec3(milieu.xz * 0.7, uTemps * 0.015)));
    stries = mix(stries, (0.1 + 1.6 * colonnes) * smoothstep(vMin.y + 1.2, vY - 0.4, milieu.y), vMin.w);
    // La diffusion vers l'avant : face au soleil, l'air s'illumine.
    float phase = 0.7 + 1.1 * pow(max(dot(v, uSoleil), 0.0), 4.0);
    // Discrets, comme à Orsay : un voile qu'on devine, jamais un mur de lumière —
    // même face au soleil, au plus dense des stries, le fond reste lisible.
    // Sous un lanterneau : une colonne d'air clair, au jour et non au soleil, plus pâle et plus douce.
    float force = mix(uForce, 0.6 * uJour, vMin.w);
    phase = mix(phase, 1.0, vMin.w);
    float a = 0.45 * force * (1.0 - exp(-l * 0.15)) * trajet * stries * phase;
    gl_FragColor = vec4(mix(uCouleur, vec3(1.0, 0.93, 0.82), vMin.w), a);
  }
`

/** Un prisme fermé par panneau : le rectangle de la vitre, tiré vers le sol le long du soleil. */
function prismes(soleil: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = []
  const vitre: number[] = []
  const cote: number[] = []
  const bornes: number[] = []
  const hautes: number[] = []
  const droit = new THREE.Vector3(0, 1, 0)
  for (const { vitre: v, min, max, doux } of FAISCEAUX) {
    const d = doux ? droit : soleil
    const haut = [
      new THREE.Vector3(v.x0, v.y, v.z0),
      new THREE.Vector3(v.x1, v.y, v.z0),
      new THREE.Vector3(v.x1, v.y, v.z1),
      new THREE.Vector3(v.x0, v.y, v.z1),
    ]
    // Jusqu'au sol de la salle, pas plus bas.
    const bas = haut.map((p) => p.clone().addScaledVector(d, -(v.y - min.y) / d.y))
    const quads = [[haut[0], haut[1], haut[2], haut[3]], [bas[0], bas[1], bas[2], bas[3]]]
    for (let i = 0; i < 4; i++) quads.push([haut[i], haut[(i + 1) % 4], bas[(i + 1) % 4], bas[i]])
    for (const [a, b, c, e] of quads)
      for (const p of [a, b, c, a, c, e]) {
        pos.push(p.x, p.y, p.z)
        vitre.push(v.x0, v.x1, v.z0, v.z1)
        cote.push(v.y)
        bornes.push(min.x, min.y, min.z, doux)
        hautes.push(max.x, max.y, max.z)
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aVitre', new THREE.Float32BufferAttribute(vitre, 4))
  g.setAttribute('aY', new THREE.Float32BufferAttribute(cote, 1))
  g.setAttribute('aMin', new THREE.Float32BufferAttribute(bornes, 4))
  g.setAttribute('aMax', new THREE.Float32BufferAttribute(hautes, 3))
  return g
}


// ── La brume ─────────────────────────────────────────────────────────────

const BRUME_VERT = /* glsl */ `
  varying vec3 vMonde;
  void main() {
    vec4 m = modelMatrix * vec4(position, 1.0);
    vMonde = m.xyz;
    gl_Position = projectionMatrix * viewMatrix * m;
  }
`
const BRUME_FRAG = /* glsl */ `
  uniform float uForce;
  uniform float uJour;
  uniform vec3 uCouleur;
  uniform vec3 uMin;
  uniform vec3 uMax;
  varying vec3 vMonde;
  void main() {
    vec3 o = cameraPosition;
    vec3 r = vMonde - o;
    float fin = length(r);
    r /= fin;
    // L'entrée du regard dans la nef, quand on la regarde du dehors (une galerie, le parvis).
    vec3 t0 = (uMin - o) / r;
    vec3 t1 = (uMax - o) / r;
    vec3 tmin = min(t0, t1);
    float entree = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float traverse = max(fin - entree, 0.0);
    // Plus dense en montant vers la verrière, où la lumière s'accroche.
    float hauteur = mix(0.7, 1.3, clamp(vMonde.y / uMax.y, 0.0, 1.0));
    float voile = (1.0 - exp(-traverse * 0.02 * hauteur)) * mix(0.06, 0.22, uJour) * (0.7 + 0.4 * uForce);
    vec3 teinte = mix(vec3(0.12, 0.11, 0.1), mix(vec3(0.82, 0.84, 0.86), uCouleur, 0.35 * uForce), uJour);
    gl_FragColor = vec4(teinte, voile);
    #include <colorspace_fragment>
  }
`

// ── La poussière ─────────────────────────────────────────────────────────

const POUSSIERE_VERT = /* glsl */ `
  uniform float uTemps;
  uniform float uForce;
  uniform float uTaille;
  uniform vec3 uSoleil;
  uniform vec3 uMin;
  uniform vec3 uMax;
  attribute vec4 aGraine;
  varying float vEclat;
  ${VITRES_GLSL()}
  void main() {
    vec3 p = position;
    float t = uTemps * (0.4 + 0.6 * aGraine.w);
    p += vec3(sin(t * 0.13 + aGraine.x * 6.28), sin(t * 0.07 + aGraine.y * 6.28) - 0.25 * fract(t * 0.004 + aGraine.z), cos(t * 0.11 + aGraine.z * 6.28)) * 0.6;
    // Dans un faisceau ? On remonte le rayon de soleil jusqu'à la verrière.
    vec3 v = p + uSoleil * ((uVitreY - p.y) / uSoleil.y);
    float travee = fract((v.z - uNefZ) / 3.5);
    float dedans = step(uVitreX.x, v.x) * step(v.x, uVitreX.y) * step(0.1, travee) * step(travee, 0.9) * step(uNefZ, v.z) * step(v.z, uNefZ + uNefD);
    vEclat = dedans * uForce * (0.5 + 0.5 * sin(t * 1.7 + aGraine.w * 40.0));
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vEclat > 0.001 ? clamp(uTaille * (0.6 + 0.8 * aGraine.x) / -mv.z, 1.0, 5.0) : 0.0;
  }
`
const POUSSIERE_FRAG = /* glsl */ `
  uniform vec3 uCouleur;
  varying float vEclat;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(uCouleur, vEclat * 0.8 * (1.0 - smoothstep(0.2, 0.5, r)));
  }
`

/** La verrière pour le shader de la poussière : son étendue en x, sa cote, la nef en z. */
function VITRES_GLSL(): string {
  const x0 = Math.min(...VITRES.map((v) => v.x0))
  const x1 = Math.max(...VITRES.map((v) => v.x1))
  const y = VITRES.reduce((s, v) => s + v.y, 0) / VITRES.length
  return `const vec2 uVitreX = vec2(${x0.toFixed(3)}, ${x1.toFixed(3)});
  const float uVitreY = ${y.toFixed(3)};
  const float uNefZ = ${NEF.z.toFixed(3)};
  const float uNefD = ${NEF.depth.toFixed(3)};`
}

function poussieres(): THREE.BufferGeometry {
  // Un tirage fixe : la même poussière à chaque visite.
  let s = 7
  const alea = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  const pos = new Float32Array(POUSSIERES * 3)
  const graine = new Float32Array(POUSSIERES * 4)
  for (let i = 0; i < POUSSIERES; i++) {
    pos.set([MIN.x + 0.6 + alea() * (MAX.x - MIN.x - 1.2), 0.8 + alea() * 15, MIN.z + 0.6 + alea() * (MAX.z - MIN.z - 1.2)], i * 3)
    graine.set([alea(), alea(), alea(), alea()], i * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aGraine', new THREE.BufferAttribute(graine, 4))
  return g
}

// ── La couche ────────────────────────────────────────────────────────────

export function RayonsLayer() {
  const { elevation, azimut, jour } = useGameStore((s) => s.ciel)
  const meteo = useGameStore((s) => s.meteo)
  const calme = useCalme()
  const force = forceDesRayons({ elevation, azimut, jour }, meteo)
  const soleil = useMemo(() => new THREE.Vector3(...directionDuSoleil({ elevation: Math.max(elevation, 12), azimut })), [elevation, azimut])
  const geometrie = useMemo(() => prismes(soleil), [soleil])
  useEffect(() => () => geometrie.dispose(), [geometrie])

  const [rayon, brume, poussiere, boite, points] = useMemo(() => {
    const commun = { uniforms: uniformes, transparent: true, depthWrite: false, fog: false }
    return [
      new THREE.ShaderMaterial({ ...commun, vertexShader: RAYON_VERT, fragmentShader: RAYON_FRAG, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      new THREE.ShaderMaterial({ ...commun, vertexShader: BRUME_VERT, fragmentShader: BRUME_FRAG, side: THREE.BackSide }),
      new THREE.ShaderMaterial({ ...commun, vertexShader: POUSSIERE_VERT, fragmentShader: POUSSIERE_FRAG, blending: THREE.AdditiveBlending }),
      new THREE.BoxGeometry(MAX.x - MIN.x, MAX.y - MIN.y, MAX.z - MIN.z).translate((MIN.x + MAX.x) / 2, (MIN.y + MAX.y) / 2, (MIN.z + MAX.z) / 2),
      poussieres(),
    ] as const
  }, [])
  useEffect(() => () => [rayon, brume, poussiere, boite, points].forEach((o) => o.dispose()), [rayon, brume, poussiere, boite, points])

   
  useEffect(() => {
    uniformes.uSoleil.value.copy(soleil)
    uniformes.uJour.value = jour
  }, [soleil, jour])
  useFrame(({ clock, size }, dt) => {
    // Le passage d'un nuage se fond en quelques secondes.
    uniformes.uForce.value += (force - uniformes.uForce.value) * Math.min(1, dt * 0.8)
    if (!calme) uniformes.uTemps.value = clock.elapsedTime
    uniformes.uTaille.value = size.height * 0.02
  })
   

  // Les lanterneaux, eux, restent clairs tant qu'il fait jour.
  const eteint = force < 0.01 && uniformes.uForce.value < 0.01 && jour < 0.01
  return (
    <group name="rayons">
      <mesh geometry={boite} material={brume} renderOrder={3} />
      {!eteint && <mesh geometry={geometrie} material={rayon} renderOrder={4} />}
      {!eteint && <points geometry={points} material={poussiere} renderOrder={5} />}
    </group>
  )
}
