/**
 * LOT 0 — Spike : peut-on rendre N toiles distinctes en UN SEUL draw call ?
 *
 * Hypothèse testée : un atlas d'images unique (petit au téléchargement) est
 * découpé au chargement en DataArrayTexture, puis échantillonné par un
 * InstancedMesh via un attribut d'instance donnant la couche.
 *
 * Ce chemin évite entièrement la chaîne KTX2/basis à l'encodage — qui n'est
 * installable ni en local (pas de formule brew, pas de paquet npm) ni
 * simplement en CI.
 *
 * Le spike expose son verdict sur `window.__SPIKE__` pour être lu par
 * l'automatisation du navigateur.
 */
import * as THREE from 'three'

const COUNT = 256 // une œuvre par dépôt du corpus de référence
const TILE_W = 256
const TILE_H = 128
const COLS = 16
const ROWS = 16

interface SpikeResult {
  status: 'ok' | 'echec'
  drawCalls: number
  triangles: number
  programs: number
  layers: number
  atlasBytes: number
  vramMB: number
  fps: number
  webgl2: boolean
  maxArrayLayers: number
  erreur?: string
}

const hud = document.getElementById('hud')!
const report = (r: Partial<SpikeResult>) => {
  ;(window as unknown as { __SPIKE__: Partial<SpikeResult> }).__SPIKE__ = r
  hud.textContent = Object.entries(r)
    .map(([k, v]) => `${k.padEnd(16)} ${v}`)
    .join('\n')
}

/**
 * Fabrique un atlas de test : COLS×ROWS tuiles distinctes, chacune avec sa
 * couleur et son numéro. Tient lieu du WebP produit au build par sharp.
 */
function makeAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = COLS * TILE_W
  c.height = ROWS * TILE_H
  const g = c.getContext('2d')!
  for (let i = 0; i < COUNT; i++) {
    const x = (i % COLS) * TILE_W
    const y = Math.floor(i / COLS) * TILE_H
    g.fillStyle = `hsl(${(i * 360) / COUNT} 65% ${30 + (i % 5) * 8}%)`
    g.fillRect(x, y, TILE_W, TILE_H)
    g.fillStyle = '#fff'
    g.font = 'bold 48px monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(i), x + TILE_W / 2, y + TILE_H / 2)
  }
  return c
}

/**
 * Découpe l'atlas en DataArrayTexture. C'est l'étape que le spike valide :
 * un seul téléchargement, N couches en VRAM, mips propres par couche
 * (contrairement à un atlas échantillonné en UV, qui bave aux bords).
 */
function sliceToArrayTexture(atlas: HTMLCanvasElement): THREE.DataArrayTexture {
  const g = atlas.getContext('2d', { willReadFrequently: true })!
  const data = new Uint8Array(TILE_W * TILE_H * 4 * COUNT)
  const stride = TILE_W * TILE_H * 4
  const rowBytes = TILE_W * 4
  for (let i = 0; i < COUNT; i++) {
    const x = (i % COLS) * TILE_W
    const y = Math.floor(i / COLS) * TILE_H
    const img = g.getImageData(x, y, TILE_W, TILE_H)
    // getImageData rend les lignes de haut en bas ; WebGL attend (0,0) en bas
    // à gauche, et UNPACK_FLIP_Y_WEBGL est ignoré pour les textures array.
    // On retourne donc verticalement à la copie — sinon les toiles sont
    // accrochées à l'envers, ce que le spike a effectivement montré.
    for (let row = 0; row < TILE_H; row++) {
      const src = row * rowBytes
      const dst = i * stride + (TILE_H - 1 - row) * rowBytes
      data.set(img.data.subarray(src, src + rowBytes), dst)
    }
  }
  const tex = new THREE.DataArrayTexture(data, TILE_W, TILE_H, COUNT)
  tex.format = THREE.RGBAFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.setPixelRatio(1)
  renderer.setSize(window.innerWidth, window.innerHeight)
  document.body.appendChild(renderer.domElement)

  const gl = renderer.getContext() as WebGL2RenderingContext
  const webgl2 = renderer.capabilities.isWebGL2 ?? true
  const maxArrayLayers = webgl2 ? gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) : 0

  if (!webgl2) {
    report({ status: 'echec', erreur: 'WebGL2 indisponible', webgl2: false })
    return
  }
  if (maxArrayLayers < COUNT) {
    report({ status: 'echec', erreur: `MAX_ARRAY_TEXTURE_LAYERS=${maxArrayLayers} < ${COUNT}`, maxArrayLayers })
    return
  }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#151515')
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500)
  camera.position.set(0, 0, 42)
  // exposé pour que la vérification par automatisation puisse zoomer sur une tuile
  ;(window as unknown as { __CAM__: THREE.PerspectiveCamera }).__CAM__ = camera

  const atlas = makeAtlas()
  const arrayTex = sliceToArrayTexture(atlas)

  // Un quad unitaire, instancié COUNT fois. L'attribut aLayer porte l'index
  // de couche ; c'est lui qui remplace N matériaux par un seul.
  const geo = new THREE.PlaneGeometry(1, 0.5)
  const layers = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) layers[i] = i
  geo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layers, 1))

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { map: { value: arrayTex } },
    vertexShader: /* glsl */ `
      in float aLayer;
      out vec2 vUv;
      flat out int vLayer;
      void main() {
        vUv = uv;
        vLayer = int(aLayer);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp sampler2DArray;
      uniform sampler2DArray map;
      in vec2 vUv;
      flat in int vLayer;
      out vec4 outColor;
      void main() {
        outColor = texture(map, vec3(vUv, float(vLayer)));
      }
    `,
  })

  const mesh = new THREE.InstancedMesh(geo, material, COUNT)
  const m = new THREE.Matrix4()
  for (let i = 0; i < COUNT; i++) {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    m.makeTranslation((col - COLS / 2) * 1.6, (ROWS / 2 - row) * 1.0, 0)
    m.scale(new THREE.Vector3(1.4, 1.4, 1))
    mesh.setMatrixAt(i, m)
  }
  mesh.instanceMatrix.needsUpdate = true
  scene.add(mesh)

  let frames = 0
  let t0 = performance.now()
  let fps = 0

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera)
    frames++
    const now = performance.now()
    if (now - t0 >= 1000) {
      fps = Math.round((frames * 1000) / (now - t0))
      frames = 0
      t0 = now

      const info = renderer.info
      report({
        status: info.render.calls <= 2 ? 'ok' : 'echec',
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs?.length ?? -1,
        layers: COUNT,
        atlasBytes: COLS * TILE_W * ROWS * TILE_H * 4,
        vramMB: Math.round((TILE_W * TILE_H * 4 * COUNT) / 1048576),
        fps,
        webgl2,
        maxArrayLayers,
      })
    }
  })
}

try {
  main()
} catch (e) {
  report({ status: 'echec', erreur: String(e) })
}
