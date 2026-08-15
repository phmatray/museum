/**
 * LOT SCULPTURES — où se posent les pièces en volume (spec 2026-08-15).
 *
 * Ce module DÉCIDE. Il ne dessine rien : `scene/SculptureLayer.tsx` prend la
 * liste et la rend. Comme tout ce qui vit dans `domain/`, il n'importe ni
 * `three` ni `react`, et tourne donc dans un test sans canvas.
 *
 * ── Pourquoi une sculpture n'est pas un prop ──
 *
 * `props.ts` sème du mobilier par dizaines, avec un générateur à graine, en
 * acceptant qu'un candidat refusé soit simplement abandonné — « on préfère une
 * salle un peu vide à une salle impraticable ». Une sculpture est l'inverse de
 * ça : elle est unique, elle est voulue à un endroit précis, et si elle ne peut
 * pas y aller il faut le SAVOIR plutôt que la voir disparaître. D'où un module
 * séparé, sans aléa du tout, et une salle introuvable qui écarte la pièce au
 * lieu de la replier sur un défaut.
 *
 * ── L'ordre compte, et il est structurel ──
 *
 * `placeSculptures` doit tourner AVANT `placeProps`, dont les emprises réservées
 * viennent d'ici. Sans ça, `poserLeBanc` pose son banc face au mur le plus
 * garni, à 2,60 m de ce mur — soit à moins de deux mètres de la pièce dans la
 * salle d'honneur du musée réel. Un test le tient.
 */
import type { Boite, EmpriseReservee } from './props'
import type { Floor, Museum, Room, Sculpture, SculptureCartel, Side, Vec3 } from './types'

// ── Contrat public ───────────────────────────────────────────────────────

export interface SculpturePlacement {
  id: string
  file: string
  /**
   * Position MONDE du point d'ancrage : le centre du socle, POSÉ SUR LA DALLE.
   * `position.y` intègre déjà l'élévation du niveau, comme `PropPlacement`.
   */
  position: Vec3
  /** Lacet, en radians, autour de Y. */
  rotation: number
  /** Hauteur réelle de la pièce seule, socle non compris. */
  height: number
  plinth: { width: number; depth: number; height: number }
  floorId: string
  roomId: string
  cartel: SculptureCartel
}

// ── Orientation ──────────────────────────────────────────────────────────

/**
 * Lacet qui met la face avant de la pièce vers le point cardinal demandé.
 *
 * Convention : le modèle exporté regarde +Z, et le nord du musée est −Z (le cap
 * 0 du point d'apparition, `derive.ts`). Une rotation θ autour de Y envoie +Z
 * sur (sin θ, 0, cos θ), d'où la table.
 *
 * `tools/blender/build-sculptures.py` est ce qui GARANTIT la convention : il
 * oriente chaque pièce pour que sa face avant regarde +Z avant d'exporter.
 */
export function yawDeFacing(facing: Side): number {
  switch (facing) {
    case 'south':
      return 0
    case 'east':
      return Math.PI / 2
    case 'north':
      return Math.PI
    case 'west':
      return -Math.PI / 2
  }
}

// ── Placement ────────────────────────────────────────────────────────────

/**
 * Pose les pièces déclarées par l'instance.
 *
 * Pur : même musée, même liste, dans l'ordre de `config.sculptures`.
 */
export function placeSculptures(museum: Museum): SculpturePlacement[] {
  const placements: SculpturePlacement[] = []

  for (const sculpture of museum.config.sculptures ?? []) {
    const hote = trouverSalle(museum, sculpture)
    if (hote === null) continue
    const { floor, room } = hote

    placements.push({
      id: sculpture.id,
      file: sculpture.file,
      position: {
        x: room.footprint.x + room.footprint.width / 2,
        y: floor.elevation,
        z: room.footprint.z + room.footprint.depth / 2,
      },
      rotation: yawDeFacing(sculpture.facing),
      height: sculpture.height,
      plinth: sculpture.plinth,
      floorId: floor.id,
      roomId: room.id,
      cartel: sculpture.cartel,
    })
  }

  return placements
}

/**
 * La salle qui reçoit la pièce.
 *
 * Sans `room`, c'est la PREMIÈRE salle du niveau 0 — la salle d'honneur, seule
 * salle réelle de ce niveau (les côtés vides reçoivent des galeries aveugles,
 * qui n'y figurent pas). C'est le lieu qui dit « ceci est la collection ».
 *
 * Une salle nommée mais introuvable rend `null`, et la pièce n'est pas posée :
 * un identifiant fautif doit produire une absence visible, pas une pièce
 * silencieusement déplacée à l'autre bout du bâtiment.
 */
function trouverSalle(
  museum: Museum,
  sculpture: Sculpture,
): { floor: Floor; room: Room } | null {
  if (sculpture.room !== undefined) {
    for (const floor of museum.floors) {
      const room = floor.rooms.find((r) => r.id === sculpture.room)
      if (room !== undefined) return { floor, room }
    }
    return null
  }

  const rdc = museum.floors.find((f) => f.level === 0)
  if (rdc === undefined || rdc.rooms.length === 0) return null
  return { floor: rdc, room: rdc.rooms[0] }
}

// ── Emprise ──────────────────────────────────────────────────────────────

/**
 * L'emprise de la pièce posée.
 *
 * En plan, c'est le SOCLE et non la pièce : le socle la contient par
 * construction — `scene/__tests__/sculptureAssets.test.ts` le vérifie sur le GLB
 * réel — et c'est lui qu'on ne doit pas heurter du pied. En hauteur, socle plus
 * pièce.
 */
export function boiteDeSculpture(p: SculpturePlacement): Boite {
  return {
    minX: p.position.x - p.plinth.width / 2,
    maxX: p.position.x + p.plinth.width / 2,
    minZ: p.position.z - p.plinth.depth / 2,
    maxZ: p.position.z + p.plinth.depth / 2,
    minY: p.position.y,
    maxY: p.position.y + p.plinth.height + p.height,
  }
}

/** Ce que `placeProps` doit réserver avant de semer quoi que ce soit. */
export function emprisesDeSculptures(
  placements: readonly SculpturePlacement[],
): EmpriseReservee[] {
  return placements.map((p) => ({ floorId: p.floorId, boite: boiteDeSculpture(p) }))
}

// ── Cartel ───────────────────────────────────────────────────────────────

/**
 * Les quatre lignes d'un cartel de musée.
 *
 * L'année rejoint le TITRE plutôt que d'occuper sa ligne : c'est la convention
 * muséographique, et une ligne « 2026 » seule sur un cartel de socle se lit
 * comme une erreur de mise en page.
 */
export function sculptureCartelText(cartel: SculptureCartel): string {
  const titre = cartel.year === undefined ? cartel.title : `${cartel.title}, ${cartel.year}`
  return [cartel.author, titre, cartel.medium, cartel.credit]
    .filter((ligne): ligne is string => ligne !== undefined && ligne !== '')
    .join('\n')
}
