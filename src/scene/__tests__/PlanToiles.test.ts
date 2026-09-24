/**
 * Tests du calcul de pose des toiles du plan (matrices canvas/cadre, orientation
 * selon la normale du mur). Seam pur — `computePoses` ne lit que `salles` — donc
 * testé directement, sans montage React ni contexte WebGL, au même niveau que
 * lighting.test.ts / materials.test.ts pour src/scene/.
 *
 * Une régression dans cette math (argument de `crossVectors` inversé, mauvais
 * décalage `FRAME_DEPTH`) ferait pivoter ou décaler silencieusement toutes les
 * toiles du plan — c'est le trou que #16 avait laissé (« vérifié à l'œil »).
 */
import { renderHook, waitFor } from '@testing-library/react'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { createElement } from 'react'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FRAME_BORDER, FRAME_DEPTH } from '../../builders/artwork'
import { DEFAULT_ASPECT } from '../../domain/hanging'
import { useAccrochage } from '../../hooks/useAccrochage'
import { resetAtlasResource } from '../../io/arrayTexture'
import type { Accrochage } from '../../plan/hang'
import { computePoses } from '../planToilesGeometry'
import { PlanToiles } from '../PlanToiles'

// Mocké : monter le <Text> réel de troika ferait un vrai chargement de police,
// hors du seam que ce fichier vérifie (le prop `font`, pas le rendu troika).
// Import différé plus bas, après le mock (hoisté par vitest de toute façon).
const { texteSalle } = vi.hoisted(() => ({ texteSalle: [] as { font?: unknown }[] }))
vi.mock('@react-three/drei', () => ({
  Text: (props: { font?: unknown }) => {
    texteSalle.push(props)
    return null
  },
}))

type Room = Accrochage['rooms'][number]
type Placement = Room['placements'][number]

function room(placements: Placement[]): Room {
  return { id: 'r-o1', level: 0, name: 'Salle test', placements }
}

function placement(over: Partial<Placement> = {}): Placement {
  return { key: 'owner/name', x: 2, y: 1.2, z: 3, normal: [1, 0], width: 1.6, ...over }
}

describe('computePoses', () => {
  it('returns [] when no room has placements', () => {
    expect(computePoses([])).toEqual([])
    expect(computePoses([room([])])).toEqual([])
  })

  it('offsets the canvas along the wall normal, past the frame depth', () => {
    const p = placement()
    const [pose] = computePoses([room([p])])

    const position = new THREE.Vector3()
    pose.canvas.decompose(position, new THREE.Quaternion(), new THREE.Vector3())

    const offset = FRAME_DEPTH + 0.004
    expect(position.x).toBeCloseTo(p.x + p.normal[0] * offset)
    expect(position.y).toBeCloseTo(p.y)
    expect(position.z).toBeCloseTo(p.z + p.normal[1] * offset)
  })

  it('scales the canvas from the placement width and DEFAULT_ASPECT', () => {
    const p = placement({ width: 2 })
    const [pose] = computePoses([room([p])])

    const scale = new THREE.Vector3()
    pose.canvas.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale)

    expect(scale.x).toBeCloseTo(p.width)
    expect(scale.y).toBeCloseTo(p.width / DEFAULT_ASPECT)
  })

  it('rotates a wall facing [0, 1] differently from one facing [1, 0]', () => {
    const [poseX] = computePoses([room([placement({ normal: [1, 0] })])])
    const [poseZ] = computePoses([room([placement({ normal: [0, 1] })])])

    const quatX = new THREE.Quaternion()
    const quatZ = new THREE.Quaternion()
    poseX.canvas.decompose(new THREE.Vector3(), quatX, new THREE.Vector3())
    poseZ.canvas.decompose(new THREE.Vector3(), quatZ, new THREE.Vector3())

    expect(quatX.equals(quatZ)).toBe(false)
  })

  it('offsets the frame by half the frame depth, widened by FRAME_BORDER', () => {
    const p = placement()
    const [pose] = computePoses([room([p])])

    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    pose.frame.decompose(position, new THREE.Quaternion(), scale)

    expect(position.x).toBeCloseTo(p.x + p.normal[0] * (FRAME_DEPTH / 2))
    expect(scale.x).toBeCloseTo(p.width + 2 * FRAME_BORDER)
    expect(scale.z).toBeCloseTo(FRAME_DEPTH)
  })
})

// `useAccrochage` est la SEULE traversée du schéma zod à l'exécution — `computePoses`
// ci-dessus ne voit plus cette étape. Sans ce test, remplacer `parseAccrochage` par un
// bricolage qui ne valide plus rien resterait vert partout (issue #24).
function reponse(corps: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 404, json: () => Promise.resolve(corps) } as Response
}

describe('useAccrochage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('charge un accrochage bien formé', async () => {
    const valide: Accrochage = { generatedAt: '2026-07-25T22:06:37.149Z', rooms: [room([placement()])] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse(valide)))

    const { result } = renderHook(() => useAccrochage())
    await waitFor(() => expect(result.current).not.toBeNull())

    expect(result.current?.rooms).toHaveLength(1)
  })

  it('rejette un accrochage mal formé sans lancer d’erreur non attrapée, et journalise un message lisible', async () => {
    const espion = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse({ rooms: [{ id: 'x' }] })))

    const { result } = renderHook(() => useAccrochage())
    await waitFor(() => expect(espion).toHaveBeenCalled())

    expect(result.current).toBeNull()
    expect(espion.mock.calls[0][0]).toBe('accrochage.json indisponible')
    expect(String((espion.mock.calls[0][1] as Error).message)).toContain('generatedAt')

    espion.mockRestore()
  })
})

// `PlanToiles` monté pour de vrai (#52) : `room()` ci-dessus retombe justement
// sur 'r-o1', une salle réelle du rez-de-chaussée (`plan/musee.ts`), donc son
// nom de salle est bien rendu. L'atlas échoue sans mock (pas de serveur au
// banc) : `useAtlas` l'avale déjà (`console.error` attendu, pas une régression
// — voir son propre commentaire) et les toiles n'en dépendent pas ici, le nom
// de salle si.
describe('PlanToiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetAtlasResource()
    texteSalle.length = 0
  })

  it('passe une police vendorisée sous BASE_URL au <Text> du nom de salle', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const accrochage: Accrochage = { generatedAt: '2026-07-25T22:06:37.149Z', rooms: [room([])] }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(reponse(accrochage, String(url).includes('accrochage.json')))),
    )

    await ReactThreeTestRenderer.create(createElement(PlanToiles, { level: 0 }))
    await waitFor(() => expect(texteSalle.length).toBeGreaterThan(0))

    expect(texteSalle[0].font).toBe(`${import.meta.env.BASE_URL}assets/fonts/PTSans-Regular.ttf`)
  })
})
