/**
 * Le musée : deux niveaux autour d'un hall en double hauteur (typologie B).
 *
 * ── Le parti ──
 *
 * On entre au sud dans un hall de 16 × 28 m, haut de deux étages. Au fond, un
 * escalier impérial : une volée centrale de 6 m monte au palier (+2,40), puis
 * deux volées latérales repartent vers le sud et débouchent sur des balcons à
 * l'étage noble (+4,80). Autour du hall, deux ailes de trois salles par niveau,
 * reliées au nord par une salle en travers. À l'étage, cette salle du nord est
 * la salle d'honneur, et sa baie donne sur le hall.
 *
 * Références : Kunsthistorisches Museum (Vienne), Altes Museum (Berlin).
 *
 * ── L'escalier ──
 *
 * Volées droites à pente constante, jamais d'hélice : une volée se parcourt
 * comme un plan incliné, ce qui supprime toute la famille de bugs de marche de
 * l'ancien bâtiment. 15 contremarches de 16 cm par volée, giron de 32 cm :
 * 2h + g = 0,64 m, au milieu de la fourchette de Blondel.
 */
import type { Plan } from './types.ts'

const STOREY = 4.8
const LANDING = STOREY / 2

export const MUSEE: Plan = {
  name: 'Musée GitHub',
  width: 48,
  depth: 40,
  storey: STOREY,
  slab: 0.3,
  spawn: { level: 0, x: 24, z: 37 },
  flights: [
    { id: 'volee-centrale', x: 21, z: 15.5, width: 6, depth: 4.5, direction: 'north', bottom: 0, top: LANDING, risers: 15 },
    { id: 'volee-ouest', x: 16, z: 15.5, width: 3, depth: 4.5, direction: 'south', bottom: LANDING, top: STOREY, risers: 15 },
    { id: 'volee-est', x: 29, z: 15.5, width: 3, depth: 4.5, direction: 'south', bottom: LANDING, top: STOREY, risers: 15 },
  ],
  landings: [{ id: 'palier', x: 16, z: 12, width: 16, depth: 3.5, elevation: LANDING }],
  levels: [
    {
      id: 0,
      name: 'Rez-de-chaussée',
      elevation: 0,
      rooms: [
        { id: 'r-o1', kind: 'gallery', name: 'Blazor', x: 0, z: 0, width: 16, depth: 13 },
        { id: 'r-o2', kind: 'gallery', name: 'Librairies .NET', x: 0, z: 13, width: 16, depth: 14 },
        { id: 'r-o3', kind: 'gallery', name: 'Claude Code', x: 0, z: 27, width: 16, depth: 13 },
        { id: 'r-n', kind: 'gallery', name: 'Jeux', x: 16, z: 0, width: 16, depth: 12 },
        { id: 'r-e1', kind: 'gallery', name: 'Trading & finance', x: 32, z: 0, width: 16, depth: 13 },
        { id: 'r-e2', kind: 'gallery', name: 'Musique & audio', x: 32, z: 13, width: 16, depth: 14 },
        { id: 'r-e3', kind: 'gallery', name: 'Aspire', x: 32, z: 27, width: 16, depth: 13 },
        { id: 'hall', kind: 'hall', name: 'Hall', x: 16, z: 12, width: 16, depth: 28 },
      ],
      openings: [
        { kind: 'entrance', a: 'hall', b: null, x: 24, z: 40, width: 3.2 },
        { kind: 'door', a: 'hall', b: 'r-o2', x: 16, z: 24, width: 2.4 },
        { kind: 'door', a: 'hall', b: 'r-o3', x: 16, z: 34, width: 2.4 },
        { kind: 'door', a: 'hall', b: 'r-e2', x: 32, z: 24, width: 2.4 },
        { kind: 'door', a: 'hall', b: 'r-e3', x: 32, z: 34, width: 2.4 },
        { kind: 'door', a: 'r-o1', b: 'r-o2', x: 8, z: 13, width: 2 },
        { kind: 'door', a: 'r-o2', b: 'r-o3', x: 8, z: 27, width: 2 },
        { kind: 'door', a: 'r-e1', b: 'r-e2', x: 40, z: 13, width: 2 },
        { kind: 'door', a: 'r-e2', b: 'r-e3', x: 40, z: 27, width: 2 },
        { kind: 'door', a: 'r-o1', b: 'r-n', x: 16, z: 6, width: 2 },
        { kind: 'door', a: 'r-n', b: 'r-e1', x: 32, z: 6, width: 2 },
      ],
      obstacles: [
        // Sous le palier : 2,10 m libres, on s'y cognerait.
        { x: 16, z: 12, width: 16, depth: 3.5 },
        // Sous les volées latérales, qui démarrent à +2,40.
        { x: 16, z: 15.5, width: 3, depth: 4.5 },
        { x: 29, z: 15.5, width: 3, depth: 4.5 },
      ],
    },
    {
      id: 1,
      name: 'Étage noble',
      elevation: STOREY,
      rooms: [
        { id: 'e-o1', kind: 'gallery', name: 'Design patterns', x: 0, z: 0, width: 16, depth: 13 },
        { id: 'e-o2', kind: 'gallery', name: 'Parsers & langages', x: 0, z: 13, width: 16, depth: 14 },
        { id: 'e-o3', kind: 'gallery', name: 'Simulation', x: 0, z: 27, width: 16, depth: 13 },
        { id: 'honneur', kind: 'honneur', name: "Salle d'honneur", x: 16, z: 0, width: 16, depth: 12 },
        { id: 'e-e1', kind: 'gallery', name: 'Belgique & outils', x: 32, z: 0, width: 16, depth: 13 },
        { id: 'e-e2', kind: 'gallery', name: 'Web & front', x: 32, z: 13, width: 16, depth: 14 },
        { id: 'e-e3', kind: 'gallery', name: 'Agents & IA', x: 32, z: 27, width: 16, depth: 13 },
        { id: 'balcon-o', kind: 'balcony', name: 'Balcon ouest', x: 16, z: 20, width: 3, depth: 20 },
        { id: 'balcon-e', kind: 'balcony', name: 'Balcon est', x: 29, z: 20, width: 3, depth: 20 },
        { id: 'balcon-s', kind: 'balcony', name: 'Balcon sud', x: 19, z: 37, width: 10, depth: 3 },
      ],
      openings: [
        { kind: 'open', a: 'balcon-o', b: 'balcon-s', x: 19, z: 38.5, width: 3 },
        { kind: 'open', a: 'balcon-s', b: 'balcon-e', x: 29, z: 38.5, width: 3 },
        { kind: 'door', a: 'balcon-o', b: 'e-o2', x: 16, z: 24, width: 2.4 },
        { kind: 'door', a: 'balcon-o', b: 'e-o3', x: 16, z: 34, width: 2.4 },
        { kind: 'door', a: 'balcon-e', b: 'e-e2', x: 32, z: 24, width: 2.4 },
        { kind: 'door', a: 'balcon-e', b: 'e-e3', x: 32, z: 34, width: 2.4 },
        { kind: 'door', a: 'e-o1', b: 'e-o2', x: 8, z: 13, width: 2 },
        { kind: 'door', a: 'e-o2', b: 'e-o3', x: 8, z: 27, width: 2 },
        { kind: 'door', a: 'e-e1', b: 'e-e2', x: 40, z: 13, width: 2 },
        { kind: 'door', a: 'e-e2', b: 'e-e3', x: 40, z: 27, width: 2 },
        { kind: 'door', a: 'e-o1', b: 'honneur', x: 16, z: 6, width: 2 },
        { kind: 'door', a: 'honneur', b: 'e-e1', x: 32, z: 6, width: 2 },
        // La salle d'honneur regarde le hall et l'escalier.
        { kind: 'bay', a: 'honneur', b: null, x: 24, z: 12, width: 6 },
      ],
      obstacles: [],
    },
  ],
}
