/**
 * L'air du dehors, dans les matières : la perspective aérienne (le lointain se
 * voile d'un air teinté par le soleil) et la brume au ras du sol, plus dense
 * près de l'herbe et de l'eau à l'aube et au soir.
 *
 * Greffé dans `fog_fragment`, comme la brume de `MeteoLayer` : la scène a
 * TOUJOURS une brume (`FogExp2`, nulle par beau temps), donc toutes les
 * matières standard passent par ce chunk, sans un programme de plus. L'air
 * s'applique AVANT la brume du temps : la pluie et le brouillard se posent
 * par-dessus, rien ne se recompile quand le temps change (#179).
 *
 * Comme la brume du temps, l'air tient au LIEU du fragment (`brumeToit`) : le
 * jardin vu par la porte de la nef est voilé autant que quand on y est ; les
 * murs du hall, eux, restent nets.
 *
 * La brume au sol suit la formule fermée d'une densité exponentielle en
 * hauteur, intégrée le long du regard : un fragment à 40 m sur l'herbe, vu à
 * hauteur d'homme, traverse toute la nappe ; la façade au-dessus d'elle, non.
 *
 * Les uniformes sont des objets ordinaires `{ x, y, z, w }` (voir `lueurs.ts`) :
 * three ne clone pas une telle valeur, toutes les matières partagent celle-ci.
 * Tant qu'ils sont nuls, rien ne change — une matière qui ne les recevrait
 * pas resterait telle qu'avant.
 */
import * as THREE from 'three'

/** rgb : la couleur de l'air au loin ; w : son épaisseur, par mètre. */
export const AIR = { x: 0, y: 0, z: 0, w: 0 }
/** x : la brume au sol (densité au niveau 0) ; y : sa décroissance, par mètre. */
export const AIR_SOL = { x: 0, y: 0.4, z: 0, w: 0 }
/** xyz : la direction du soleil ; w : la force de la lueur face à lui. */
export const AIR_SOLEIL = { x: 0, y: 1, z: 0, w: 0 }
/** rgb : la couleur de cette lueur. */
export const AIR_LUEUR = { x: 1, y: 1, z: 1, w: 0 }

const UNIFORMES = { uAir: { value: AIR }, uAirSol: { value: AIR_SOL }, uAirSoleil: { value: AIR_SOLEIL }, uAirLueur: { value: AIR_LUEUR } }

/** Le calcul, commun aux matières (chunk de brume) et au ciel (`Ciel.tsx`). */
export const AIR_GLSL = /* glsl */ `
uniform vec4 uAir;
uniform vec4 uAirSol;
uniform vec4 uAirSoleil;
uniform vec4 uAirLueur;
// La couleur de l'air dans la direction d (normée) : bleue ou dorée, qui s'allume face au soleil.
vec3 airCouleur(vec3 d) {
  float face = max(dot(d, uAirSoleil.xyz), 0.0);
  return uAir.rgb + uAirLueur.rgb * uAirSoleil.w * (0.25 * face * face + pow(face, 12.0));
}
// La part d'air entre l'œil o et le point p.
float airVoile(vec3 o, vec3 p) {
  vec3 v = p - o;
  float l = length(v);
  float b = max(uAirSol.y, 1e-3);
  float h0 = max(o.y, -2.0);
  float e0 = exp(-b * h0);
  float moyenne = abs(v.y) > 0.05 ? (e0 - exp(-b * max(o.y + v.y, -2.0))) / (b * v.y) : e0;
  return 1.0 - exp(-l * (uAir.w + uAirSol.x * moyenne));
}
`

for (const lib of Object.values(THREE.ShaderLib)) {
  if ('fogDensity' in lib.uniforms) Object.assign(lib.uniforms, UNIFORMES)
}
Object.assign(THREE.UniformsLib.fog, UNIFORMES)

const C = THREE.ShaderChunk
// Une seule fois, même si le module est réévalué (rechargement à chaud).
if (!C.fog_pars_fragment.includes('airVoile')) {
  C.fog_pars_fragment = C.fog_pars_fragment.replace('#ifdef USE_FOG', `#ifdef USE_FOG\n${AIR_GLSL}`)
  C.fog_fragment = C.fog_fragment.replace(
    'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    `if (uAir.w + uAirSol.x > 0.0) {
		// Dehors seulement : au-dessus des toits, ou hors de leur emprise (\`MeteoLayer\`).
		float airDehors = step(brumeToit(vFogMonde.xz), vFogMonde.y);
		vec3 airV = vFogMonde - cameraPosition;
		gl_FragColor.rgb = mix(gl_FragColor.rgb, airCouleur(normalize(airV)), airDehors * airVoile(cameraPosition, vFogMonde));
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );`,
  )
}
