/** Le « Lien copié » d'un partage de tableau (`partager.ts`). */
import { useEffect } from 'react'

import { useMessage } from './partager'

/** Le message du partage, en haut de l'écran : deux secondes et demie, huit s'il faut copier à la main. */
export function MessagePartage() {
  const { copie, lien, at } = useMessage()
  useEffect(() => {
    if (copie === null) return
    const id = setTimeout(() => useMessage.setState({ copie: null }), copie ? 2500 : 8000)
    return () => clearTimeout(id)
  }, [copie, at])
  if (copie === null) return null
  return (
    <div
      role="status"
      data-partage
      style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1500, maxWidth: 'calc(100vw - 32px)',
        padding: '8px 16px', borderRadius: 8, background: 'rgba(18,16,14,0.9)', border: '1px solid rgba(255,214,150,0.35)',
        color: '#f3efe6', font: '14px/1.4 system-ui, sans-serif', textAlign: 'center', animation: 'message-partage 200ms ease-out',
      }}
    >
      <style>{'@keyframes message-partage { from { opacity: 0; transform: translate(-50%, -6px) } } @media (prefers-reduced-motion: reduce) { [data-partage] { animation: none !important } }'}</style>
      <strong style={{ color: '#ffd796' }}>{copie ? '✓ Lien copié' : 'Copiez ce lien'}</strong>
      <div style={{ fontSize: 12, color: '#c9c2b4', overflowWrap: 'anywhere', userSelect: 'all' }}>{lien}</div>
    </div>
  )
}
