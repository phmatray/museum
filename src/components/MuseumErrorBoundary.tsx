/**
 * La frontière d'erreur du musée.
 *
 * ── Pourquoi elle existe ──
 *
 * `museum.json` est validé au chargement par un schéma qui produit des messages
 * précis — « floors[2].rooms[0].walls[1].openings[0].kind — valeur invalide ».
 * Sans frontière, personne ne les lisait JAMAIS : `use()` sur une promesse
 * rejetée relance l'erreur pendant le rendu, React démonte la racine, et
 * l'utilisateur reste devant « Ouverture du musée… » pour toujours. C'est
 * exactement ce qui est arrivé en ajoutant le type d'ouverture `window` : le
 * schéma le refusait, le message existait, et l'écran ne montrait rien.
 *
 * Un musée qui refuse de s'ouvrir est acceptable. Un musée qui fait semblant de
 * charger indéfiniment ne l'est pas : le premier se diagnostique en dix
 * secondes, le second se diagnostique au débogueur.
 *
 * ── Pourquoi une classe ──
 *
 * `componentDidCatch` n'a pas d'équivalent en composant de fonction. C'est le
 * seul endroit du projet où une classe est la bonne réponse.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  erreur: Error | null
}

/** Les détails lisibles d'une `SchemaError`, si c'en est une. */
function details(erreur: Error): string[] {
  const peutEtre = erreur as Error & { details?: unknown }
  return Array.isArray(peutEtre.details) ? (peutEtre.details as string[]) : []
}

export class MuseumErrorBoundary extends Component<Props, State> {
  state: State = { erreur: null }

  static getDerivedStateFromError(erreur: Error): State {
    return { erreur }
  }

  componentDidCatch(erreur: Error, info: ErrorInfo): void {
    // La console garde la trace complète : l'écran n'affiche que ce qui est
    // actionnable, la console garde de quoi remonter à la ligne.
    console.error('[museum] le musée n’a pas pu s’ouvrir', erreur, info.componentStack)
  }

  render(): ReactNode {
    const { erreur } = this.state
    if (erreur === null) return this.props.children

    const lignes = details(erreur)

    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem clamp(1rem, 8vw, 6rem)',
          background: '#0e1116',
          color: 'rgba(255,255,255,0.86)',
          font: '400 0.95rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
          overflow: 'auto',
        }}
      >
        <h1 style={{ font: '600 1.35rem/1.3 system-ui, sans-serif', margin: 0 }}>
          Le musée n’a pas pu s’ouvrir
        </h1>
        <p style={{ margin: 0, color: 'rgba(255,255,255,0.62)' }}>
          {erreur.name === 'SchemaError'
            ? 'Le fichier du musée ne correspond pas à ce que la scène sait lire. Il a probablement été produit par une autre version du pipeline : relancer « node tools/derive-museum.ts » le régénère.'
            : erreur.message}
        </p>
        {lignes.length > 0 && (
          <ul
            style={{
              margin: 0,
              paddingLeft: '1.2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
              color: '#ffb4a2',
            }}
          >
            {lignes.slice(0, 12).map((ligne) => (
              <li key={ligne}>{ligne}</li>
            ))}
            {lignes.length > 12 && (
              <li style={{ color: 'rgba(255,255,255,0.5)' }}>
                … et {lignes.length - 12} autre{lignes.length - 12 > 1 ? 's' : ''}
              </li>
            )}
          </ul>
        )}
      </div>
    )
  }
}
