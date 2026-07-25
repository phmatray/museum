/**
 * L'ACCÈS À L'ESCALIER.
 *
 * Ce test existe parce qu'il manquait, et son absence a coûté un musée dont on
 * ne pouvait pas changer d'étage. L'escalier hélicoïdal vit DANS la trémie de
 * l'atrium ; la trémie est ceinturée d'un garde-corps sur tout son périmètre ;
 * personne ne disait où l'escalier arrive. Résultat mesuré sur le musée réel :
 * première marche en (−4,8 ; 0), vide de −6 à 6, et 1,10 m de garde-corps
 * continu entre le visiteur et la première marche.
 *
 * Aucune pièce n'était fausse. La dalle était juste, le garde-corps était juste,
 * l'escalier était juste. C'est leur RENCONTRE qui ne l'était pas — et une
 * rencontre n'appartient à aucun des deux fichiers, donc à aucun de leurs tests.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildRailing } from '../../builders/slab'
import { buildSlab } from '../../builders/slab'
import { landingsForFloor } from '../landings'
import type { Museum } from '../types'

const museum = JSON.parse(
  readFileSync(resolve(__dirname, '../../../public/data/museum.json'), 'utf8'),
) as Museum

const RAILING_HEIGHT = 1.1

describe('accès à l’escalier', () => {
  it('chaque escalier a ses deux bouts posés sur une dalle réelle', () => {
    // Un escalier dont un bout ne tombe sur aucun plancher ne mène nulle part.
    const elevations = museum.floors.map((f) => f.elevation)
    for (const ramp of museum.ramps) {
      for (const y of [ramp.baseElevation, ramp.baseElevation + ramp.rise]) {
        expect(
          elevations.some((e) => Math.abs(e - y) < 1e-4),
          `${ramp.id} : bout à y=${y}, aucun plancher à cette altitude`,
        ).toBe(true)
      }
    }
  })

  it('chaque niveau à trémie a au moins un palier', () => {
    // Un plateau percé mais sans escalier qui l'atteigne est un cul-de-sac
    // vertical : on y arrive, on n'en repart pas.
    for (const floor of museum.floors) {
      if (floor.slabHoles.length === 0) continue
      expect(
        landingsForFloor(museum, floor.elevation).length,
        `${floor.id} : trémie sans aucun palier`,
      ).toBeGreaterThan(0)
    }
  })

  it('LE GARDE-CORPS S’OUVRE à chaque palier', () => {
    // Le test qui manquait. On construit le garde-corps réel du niveau, et on
    // vérifie qu'AUCUN de ses triangles ne se trouve dans le passage.
    for (const floor of museum.floors) {
      if (floor.slabHoles.length === 0) continue
      const slab = buildSlab(floor.footprint, floor.slabHoles, 0.4)
      const paliers = landingsForFloor(museum, floor.elevation)
      const gaps = paliers.map((p) => ({ centre: p.position, rayon: p.rayon }))
      const railing = buildRailing(slab.railingSegments, RAILING_HEIGHT, gaps)

      const pos = railing.geometry.getAttribute('position')
      for (const palier of paliers) {
        let dansLePassage = 0
        for (let i = 0; i < pos.count; i++) {
          const d = Math.hypot(pos.getX(i) - palier.position.x, pos.getZ(i) - palier.position.z)
          // Le seuil est SOUS le rayon du palier : la découpe laisse forcément
          // des sommets sur le bord du trou, ce qui est normal. Ce qu'on
          // interdit, c'est du garde-corps AU MILIEU du passage.
          if (d < palier.rayon * 0.6) dansLePassage++
        }
        expect(
          dansLePassage,
          `${floor.id} : garde-corps en travers du palier de ${palier.rampId}`,
        ).toBe(0)
      }
    }
  })

  it('le garde-corps reste FERMÉ partout ailleurs', () => {
    // La correction ne doit pas ouvrir le vide en grand : ce qui protégeait doit
    // continuer de protéger. On compare la longueur retirée à celle attendue.
    for (const floor of museum.floors) {
      if (floor.slabHoles.length === 0) continue
      const slab = buildSlab(floor.footprint, floor.slabHoles, 0.4)
      const paliers = landingsForFloor(museum, floor.elevation)
      const gaps = paliers.map((p) => ({ centre: p.position, rayon: p.rayon }))

      const longueur = (r: { segments: { a: { x: number; z: number }; b: { x: number; z: number } }[] }) =>
        r.segments.reduce((n, s) => n + Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), 0)

      const plein = longueur(buildRailing(slab.railingSegments, RAILING_HEIGHT, []))
      const ouvert = longueur(buildRailing(slab.railingSegments, RAILING_HEIGHT, gaps))

      // On mesure la LONGUEUR et non le nombre de sommets : découper un segment
      // en deux ajoute des sommets tout en retirant de la protection.
      expect(ouvert).toBeLessThan(plein)
      // Au plus un tiers retiré : au-delà, ce n'est plus une ouverture de
      // passage, c'est un garde-corps qui a disparu.
      expect(ouvert / plein, `${floor.id}`).toBeGreaterThan(0.66)
      // Et l'ouverture doit valoir à peu près la largeur des paliers, pas plus.
      const attendu = paliers.reduce((n, p) => n + 2 * p.rayon, 0)
      expect(plein - ouvert, `${floor.id}`).toBeLessThan(attendu * 1.6)
    }
  })

  it('le garde-corps ouvert garde un collider', () => {
    // Ouvrir un passage ne doit pas rendre décoratif ce qui reste : le vide de
    // l'atrium est une chute de 4,70 m.
    const floor = museum.floors.find((f) => f.slabHoles.length > 0)!
    const slab = buildSlab(floor.footprint, floor.slabHoles, 0.4)
    const gaps = landingsForFloor(museum, floor.elevation).map((p) => ({
      centre: p.position,
      rayon: p.rayon,
    }))
    const railing = buildRailing(slab.railingSegments, RAILING_HEIGHT, gaps)
    expect(railing.collider.indices.length).toBeGreaterThan(0)
    expect(railing.collider.indices.length % 3).toBe(0)
  })
})
