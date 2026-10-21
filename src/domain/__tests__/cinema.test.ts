import { describe, expect, it } from 'vitest'

import { lireFlux, titreDeShort } from '../cinema'

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

