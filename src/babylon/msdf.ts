/**
 * Les textes nets : l'addon MSDF Text de Babylon (`@babylonjs/addons/msdfText`).
 * Chaque glyphe est un quad instancié qui lit un champ de distance multicanal
 * (`public/msdf/<police>.png|json`, `tools/generer-msdf.ts`) : net de près,
 * sans crénelage de loin, à toute taille. UN appel de dessin par lot
 * (`TextRenderer`, une police et une couleur), quel que soit le nombre de textes.
 *
 * Un lot n'est pas un maillage : il est dessiné à la fin de la passe de la
 * caméra (`onAfterDrawPhaseObservable`), dans la cible HDR de la scène, avant
 * le post-traitement (tone mapping, bloom, étalonnage s'y appliquent comme aux
 * matières non éclairées). Il teste la profondeur sans l'écrire : les murs du
 * bâtiment, toujours dessinés, le cachent d'une salle à l'autre, sans passer
 * par les `layerMask` de visibilite.ts. Ni les sondes ni la carte d'ombre ne le
 * voient (elles ne passent pas par cette phase). Non éclairé : une couleur
 * linéaire, constante (enseignes, cartels, noms de salle).
 *
 * Le texte est du texte : `addParagraph` n'interprète rien (aucun balisage) ;
 * un caractère absent de l'atlas est sauté.
 */
import { FontAsset } from '@babylonjs/addons/msdfText/fontAsset'
import { msdfVertexShader } from '@babylonjs/addons/msdfText/shaders/msdf.vertex'
import { msdfVertexShaderWGSL } from '@babylonjs/addons/msdfText/shadersWGSL/msdf.vertex'
import { TextRenderer } from '@babylonjs/addons/msdfText/textRenderer'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

export type PoliceMsdf = 'marcellus' | 'source-sans-3'

/** Ce que l'on relit du JSON (BMFont) : la taille de l'em, l'interligne, l'étendue du champ et les avances, en pixels de l'atlas. */
export interface Metriques {
  info: { size: number }
  common: { lineHeight: number }
  distanceField: { distanceRange: number }
  chars: { id: number; xadvance: number }[]
}

/**
 * Le fragment de l'addon, à un calcul près : le fondu mesure l'étendue du champ en pixels d'écran
 * (`fwidth` des UV, la formule de msdfgen) au lieu de `fwidth` de la distance, et ne la laisse
 * jamais sous un pixel. Avec celui de l'addon, un nom de salle vu à 11 m (12 px de haut) perdait
 * des morceaux de lettres (la dérivée de la distance s'annule au milieu d'un trait plus fin qu'un
 * pixel). Mêmes uniformes ; ni contour ni écriture de profondeur (inutilisés ici).
 */
const fragment = (etendue: number, wgsl: boolean) => wgsl
  ? `var fontAtlas: texture_2d<f32>;var fontAtlasSampler: sampler;uniform uColor: vec4f;uniform thickness: f32;uniform uStrokeColor: vec4f;uniform uStrokeInsetWidth: f32;uniform uStrokeOutsetWidth: f32;uniform uDepthWrite: f32;varying atlasUV: vec2f;
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {let s=textureSample(fontAtlas,fontAtlasSampler,input.atlasUV).rgb;let sd=max(min(s.r,s.g),min(max(s.r,s.g),s.b))-0.5+uniforms.thickness;let unite=vec2f(${etendue.toFixed(1)})/vec2f(textureDimensions(fontAtlas,0));let ecran=vec2f(1.0)/max(fwidth(input.atlasUV),vec2f(1e-7));let px=max(0.5*dot(unite,ecran),1.0);fragmentOutputs.color=vec4f(uniforms.uColor.rgb,clamp(sd*px+0.5,0.0,1.0)*uniforms.uColor.a);}`
  : `#extension GL_OES_standard_derivatives : enable
precision highp float;uniform sampler2D fontAtlas;uniform vec4 uColor;uniform vec4 uStrokeColor;uniform float uStrokeInsetWidth;uniform float uStrokeOutsetWidth;uniform float thickness;uniform float uDepthWrite;varying vec2 atlasUV;
void main(void) {vec3 s=texture2D(fontAtlas,atlasUV).rgb;float sd=max(min(s.r,s.g),min(max(s.r,s.g),s.b))-0.5+thickness;vec2 unite=vec2(${etendue.toFixed(1)})/vec2(textureSize(fontAtlas,0));vec2 ecran=vec2(1.0)/max(fwidth(atlasUV),vec2(1e-7));float px=max(0.5*dot(unite,ecran),1.0);gl_FragColor=vec4(uColor.rgb,clamp(sd*px+0.5,0.0,1.0)*uColor.a);}`

/** La largeur d'un texte en em (avances, sans crénage : l'atlas n'en a pas). */
const avancesDe = new WeakMap<Metriques, Map<number, number>>()
export function largeurEm(m: Metriques, texte: string): number {
  let avances = avancesDe.get(m)
  if (!avances) avancesDe.set(m, (avances = new Map(m.chars.map((c) => [c.id, c.xadvance]))))
  let l = 0
  for (const c of texte) l += avances.get(c.codePointAt(0)!) ?? 0
  return l / m.info.size
}

/**
 * La couleur d'un lettrage lumineux, telle que l'écrivait une plaque StandardMaterial non
 * éclairée : sa texture (sRGB, relue en linéaire) PLUS son `emissiveColor` (`ajout`, gris),
 * qui s'y ajoute dans le shader : les enseignes gardent leur éclat d'avant.
 */
export const eclatant = (hex: string, ajout = 0): Color3 => Color3.FromHexString(hex).toLinearSpace().addInPlaceFromFloats(ajout, ajout, ajout)

/** Le « 600 » des enseignes : Marcellus n'a qu'une graisse, le champ de distance l'épaissit. */
export const GRAS = 0.25

/** Le corps (m) d'une ligne : `corps`, réduit pour qu'elle tienne dans `largeur` (m). */
export const corpsQuiTient = (m: Metriques, texte: string, corps: number, largeur: number): number => Math.min(corps, largeur / Math.max(largeurEm(m, texte), 1e-6))

/** La droite d'un texte posé sur un mur de normale horizontale (nx, nz), lu de face. */
export const droiteDe = (nx: number, nz: number): [number, number, number] => [nz, 0, -nx]

/** Le repère d'un paragraphe : `droite`, `haut` unitaires (normale droite × haut, face lue), `corps` = l'em en mètres. */
export function repere(centre: readonly number[], droite: readonly number[], haut: readonly number[], corps: number): Matrix {
  const [d, h] = [droite, haut]
  const n = [d[1] * h[2] - d[2] * h[1], d[2] * h[0] - d[0] * h[2], d[0] * h[1] - d[1] * h[0]]
  return Matrix.FromArray([
    d[0] * corps, d[1] * corps, d[2] * corps, 0,
    h[0] * corps, h[1] * corps, h[2] * corps, 0,
    n[0], n[1], n[2], 0,
    centre[0], centre[1], centre[2], 1,
  ])
}

const polices = new Map<PoliceMsdf, Promise<{ asset: FontAsset; metriques: Metriques }>>()

/** La police (atlas et métriques), chargée une fois. */
export function policeMsdf(scene: Scene, nom: PoliceMsdf): Promise<{ asset: FontAsset; metriques: Metriques }> {
  let p = polices.get(nom)
  if (!p) {
    const base = `${import.meta.env.BASE_URL}msdf/${nom}`
    p = fetch(`${base}.json`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${base}.json : ${r.status}`))))
      .then((json) => {
        const asset = new FontAsset(json, `${base}.png`, scene)
        // Sans mipmaps (l'addon les active) : moyennés, les trois canaux ne disent plus le contour
        // et les traits fins se cassent de loin ; au niveau 0, le fondu en fwidth suffit.
        for (const t of asset.textures) t.updateSamplingMode(Texture.BILINEAR_SAMPLINGMODE)
        return { asset, metriques: JSON.parse(json) as Metriques }
      })
    polices.set(nom, p)
    scene.onDisposeObservable.addOnce(() => polices.delete(nom))
  }
  return p
}

export interface Paragraphe {
  texte: string
  /** `repere()` : centre du bloc (ou bord gauche, `aGauche`), axes et corps. */
  matrice: Matrix
  /** Le pas des lignes, en em (défaut : celui de la police). */
  interligne?: number
  /** Aligné à gauche sur l'origine du repère (sinon centré dessus). */
  aGauche?: boolean
}

/**
 * Un lot de textes d'une police et d'une couleur (linéaire, déjà multipliée par
 * son éclat), dessiné à chaque passe de caméra. `epaisseur` : graisse ajoutée
 * (−0,5 à 0,5, 0 = celle de la police).
 */
export async function textesMsdf(scene: Scene, police: PoliceMsdf, couleur: Color3, paragraphes: readonly Paragraphe[], epaisseur = 0): Promise<TextRenderer> {
  const { asset, metriques } = await policeMsdf(scene, police)
  const r = await TextRenderer.CreateTextRendererAsync(asset, scene.getEngine())
  // ponytail : `_setShaders` est privé (l'addon ne laisse pas choisir son fragment) ; à revoir à chaque montée de l'addon.
  const wgsl = scene.getEngine().isWebGPU
  ;(r as unknown as { _setShaders(v: string, f: string): void })._setShaders(
    wgsl ? msdfVertexShaderWGSL.shader : msdfVertexShader.shader, fragment(metriques.distanceField.distanceRange, wgsl))
  r.color = { r: couleur.r, g: couleur.g, b: couleur.b, a: 1 }
  r.thicknessControl = epaisseur
  for (const p of paragraphes) {
    r.addParagraph(p.texte, {
      letterSpacing: 0,
      lineHeight: p.interligne === undefined ? 1 : (p.interligne * metriques.info.size) / metriques.common.lineHeight,
      textAlign: p.aGauche ? 'left' : 'center',
      translate: { x: p.aGauche ? 0 : -0.5, y: -0.5 },
    }, p.matrice)
  }
  const o = scene.onAfterDrawPhaseObservable.add(() => r.render(scene.getViewMatrix(), scene.getProjectionMatrix()))
  scene.onDisposeObservable.addOnce(() => {
    scene.onAfterDrawPhaseObservable.remove(o)
    r.dispose()
  })
  return r
}
