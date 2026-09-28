/** L'heure de l'horloge de la nef, sans three : testable seule. */

/**
 * Les angles des aiguilles, en radians depuis midi, dans le sens horaire.
 * L'aiguille des heures avance avec les minutes, celle des minutes avec les secondes.
 */
export function anglesHorloge(d: Date): { heures: number; minutes: number } {
  const minutes = d.getMinutes() + d.getSeconds() / 60
  return { heures: (2 * Math.PI * ((d.getHours() % 12) + minutes / 60)) / 12, minutes: (2 * Math.PI * minutes) / 60 }
}
