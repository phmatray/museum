import { describe, expect, it } from 'vitest'

import { lireFlux, titreDeShort } from '../cinema'
import { appliquer, homographie, matrice3d } from '../projection'

const FLUX = `<feed><title>Atypical Craft</title>
<entry><yt:videoId>YKPcVDwvxsg</yt:videoId><title>Mon musée suit le vrai soleil 🌙 #shorts</title><published>2026-10-16T10:00:00+00:00</published></entry>
<entry><yt:videoId>cHgop3wo3iM</yt:videoId><title>Claude Code : apprends &amp; force</title><published>2026-10-14T16:00:34+00:00</published></entry>
</feed>`

describe('le programme du cinéma', () => {
  it('lit les vidéos du flux dans l’ordre, entités décodées', () => {
    expect(lireFlux(FLUX)).toEqual([
      { video: 'YKPcVDwvxsg', titre: 'Mon musée suit le vrai soleil 🌙 #shorts', publie: '2026-10-16T10:00:00+00:00' },
      { video: 'cHgop3wo3iM', titre: 'Claude Code : apprends & force', publie: '2026-10-14T16:00:34+00:00' },
    ])
  })
  it('reconnaît un Short à son titre', () => {
    expect(titreDeShort('Mon musée #shorts')).toBe(true)
    expect(titreDeShort('Claude Code : apprends')).toBe(false)
  })
})

describe('la projection du lecteur sur la toile', () => {
  const coins = [[100, 80], [900, 120], [880, 560], [130, 600]] as const
  it('envoie les quatre coins du rectangle sur ceux du quadrilatère', () => {
    const H = homographie(1600, 900, coins)!
    const src = [[0, 0], [1600, 0], [1600, 900], [0, 900]] as const
    src.forEach((p, i) => {
      const [u, v] = appliquer(H, p)
      expect(u).toBeCloseTo(coins[i][0], 6)
      expect(v).toBeCloseTo(coins[i][1], 6)
    })
  })
  it('un rectangle sur lui-même : l’identité', () => {
    expect(matrice3d(200, 100, [[0, 0], [200, 0], [200, 100], [0, 100]])).toBe('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)')
  })
  it('des coins alignés (toile vue par la tranche) : pas de matrice', () => {
    expect(matrice3d(100, 100, [[0, 0], [10, 0], [20, 0], [30, 0]])).toBeNull()
  })
})
