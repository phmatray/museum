/**
 * LOT 5 — L'éditeur en mode PLAN (spec §10).
 *
 * Une vue de dessus par niveau, en SVG. On y voit ce que le générateur a décidé,
 * on clique une salle, on la renomme, on la rethème, on la change d'étage — puis
 * **Régénérer** recalcule tout le bâtiment et **Enregistrer** écrit
 * `curation.json`.
 *
 * ── Pourquoi le SVG et pas la 3D ──
 *
 * Un plan sert à COMPARER : quelle salle est trop grande, laquelle est coincée
 * en angle, où sont les galeries. Une vue subjective ne répond à aucune de ces
 * questions, et une vue de dessus en 3D coûterait une caméra, un rendu et des
 * contrôles pour donner exactement l'image qu'un SVG donne gratuitement. Le mode
 * accrochage (lot 6), lui, sera bien en 3D : viser une œuvre n'a de sens qu'en
 * la regardant.
 *
 * Ce fichier ne s'installe qu'en développement, derrière un `import.meta.env.DEV`
 * dans `App` : il ne peut pas exister dans le bundle publié.
 */
/*
  AUCUN raccourci `font` dans ce fichier, et c'est délibéré.

  React avertit dès qu'un même élément reçoit à la fois une propriété raccourcie
  et une propriété détaillée qui la recouvre — ici `font` et `fontSize` — parce
  que l'ordre d'application entre deux rendus n'est pas garanti et produit des
  styles qui changent tout seuls. On écrit donc `fontFamily`, `fontSize`,
  `fontWeight` et `lineHeight` séparément partout.
*/
import { useEffect, useMemo } from 'react'

import type { Floor, Museum, Rect, Room } from '../domain/types'
import { THEMES, useEditorStore } from './curationStore'

export interface PlanEditorProps {
  /** Le musée du disque, affiché tant qu'aucune régénération n'a eu lieu. */
  publie: Museum
}

/** Marge du dessin, en pixels. */
const MARGE = 18
const COTE = 520

const COULEUR_THEME: Record<string, string> = {
  classic: '#c7b8a1',
  modern: '#b8c6d0',
  immersive: '#d8c7b0',
  vault: '#8e8578',
}

export function PlanEditor({ publie }: PlanEditorProps) {
  const ouvert = useEditorStore((s) => s.ouvert)
  const basculer = useEditorStore((s) => s.basculer)

  // `E` bascule l'éditeur. Ignoré pendant une saisie, sans quoi taper « e » dans
  // le champ de nom refermerait le panneau qu'on est en train d'utiliser.
  useEffect(() => {
    function surTouche(e: KeyboardEvent) {
      if (e.key !== 'e' && e.key !== 'E') return
      const cible = e.target as HTMLElement | null
      if (cible && /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      basculer()
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [basculer])

  if (!ouvert) return <Poignee onOuvrir={basculer} />
  return <Panneau publie={publie} />
}

function Poignee({ onOuvrir }: { onOuvrir: () => void }) {
  return (
    <button
      onClick={onOuvrir}
      title="Éditeur de curation (E)"
      style={{
        position: 'fixed',
        left: '1rem',
        top: '1rem',
        zIndex: 1200,
        padding: '0.4rem 0.7rem',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '0.8rem',
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: '0.04em',
        background: 'rgba(14,17,22,0.72)',
        color: 'rgba(255,255,255,0.82)',
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      ÉDITEUR · E
    </button>
  )
}

function Panneau({ publie }: PlanEditorProps) {
  const {
    entrees,
    panne,
    museum,
    modifie,
    enregistrement,
    niveau,
    selection,
    basculer,
    choisirNiveau,
    selectionner,
    modifierSalle,
    regenerer,
    enregistrer,
    reinitialiser,
  } = useEditorStore()

  // Le musée AFFICHÉ dans le plan : celui de la dernière régénération s'il y en
  // a eu une, sinon celui du disque. C'est ce qui rend « Régénérer » visible.
  const affiche = museum ?? publie
  const etage = useMemo(
    () => affiche.floors.find((f) => f.level === niveau) ?? affiche.floors[0],
    [affiche, niveau],
  )
  const salle = useMemo(
    () => etage?.rooms.find((r) => r.id === selection) ?? null,
    [etage, selection],
  )
  const override = entrees && selection ? (entrees.curation.rooms[selection] ?? {}) : {}

  return (
    <aside
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: 'min(600px, 46vw)',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '1rem',
        overflowY: 'auto',
        background: 'rgba(12,15,20,0.94)',
        color: 'rgba(255,255,255,0.88)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '0.85rem',
        fontWeight: 400,
        lineHeight: 1.5,
        borderRight: '1px solid rgba(255,255,255,0.14)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
        <strong style={{ fontFamily: 'system-ui, sans-serif', fontSize: '1rem', fontWeight: 600 }}>
          Plan
        </strong>
        <span style={{ opacity: 0.55, fontSize: '0.78rem' }}>
          {museum ? 'régénéré, non publié' : 'tel que publié'}
        </span>
        <button onClick={basculer} style={{ ...BOUTON, marginLeft: 'auto' }}>
          Fermer · E
        </button>
      </header>

      {panne !== null && (
        <p style={ALERTE}>
          Entrées indisponibles : {panne}. L’éditeur n’existe qu’avec{' '}
          <code>npm run dev</code> — le site publié est statique et n’a rien à écrire.
        </p>
      )}

      <nav style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
        {affiche.floors.map((f) => (
          <button
            key={f.id}
            onClick={() => choisirNiveau(f.level)}
            style={{ ...BOUTON, ...(f.level === niveau ? BOUTON_ACTIF : null) }}
          >
            {f.name}
          </button>
        ))}
      </nav>

      {etage && (
        <PlanSvg
          etage={etage}
          atrium={affiche.atrium}
          selection={selection}
          onSelect={selectionner}
        />
      )}

      {salle === null ? (
        <p style={{ opacity: 0.6 }}>
          Clique une salle pour la renommer, la rethémer ou la changer d’étage.
        </p>
      ) : (
        <ProprietesSalle
          salle={salle}
          override={override}
          niveaux={affiche.floors.map((f) => f.level)}
          onChange={(patch) => modifierSalle(salle.id, patch)}
        />
      )}

      <footer style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={regenerer} style={{ ...BOUTON, ...BOUTON_FORT }} disabled={entrees === null}>
          Régénérer
        </button>
        <button onClick={() => void enregistrer()} style={BOUTON} disabled={!modifie}>
          Enregistrer
        </button>
        <button onClick={reinitialiser} style={BOUTON}>
          Repartir du disque
        </button>
        <span style={{ fontSize: '0.78rem', opacity: 0.75 }}>
          {enregistrement.statut === 'en-cours' && 'écriture…'}
          {enregistrement.statut === 'ok' && 'curation.json écrit'}
          {enregistrement.statut === 'erreur' && (
            <span style={{ color: '#ffb4a2' }}>{enregistrement.message}</span>
          )}
          {enregistrement.statut === 'inactif' && modifie && 'modifications non enregistrées'}
        </span>
      </footer>

      <p style={{ fontSize: '0.75rem', opacity: 0.5, margin: 0 }}>
        <strong>Régénérer</strong> rejoue la dérivation complète dans le navigateur, avec la
        même fonction que la CI. S’il perd du travail, c’est la séparation
        catalogue/curation qui fuit — c’est le test de santé de l’architecture, pas
        un bouton d’aperçu.
      </p>
    </aside>
  )
}

// ── Le plan ──────────────────────────────────────────────────────────────

function PlanSvg({
  etage,
  atrium,
  selection,
  onSelect,
}: {
  etage: Floor
  atrium: Rect
  selection: string | null
  onSelect: (id: string | null) => void
}) {
  const f = etage.footprint
  // Une seule échelle pour les deux axes : un plan qui étire un côté ment sur
  // les proportions, ce qui est exactement ce qu'on vient regarder.
  const echelle = (COTE - 2 * MARGE) / Math.max(f.width, f.depth)
  const px = (x: number) => MARGE + (x - f.x) * echelle
  const pz = (z: number) => MARGE + (z - f.z) * echelle

  return (
    <svg
      viewBox={`0 0 ${COTE} ${COTE}`}
      style={{ width: '100%', height: 'auto', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}
      onClick={() => onSelect(null)}
    >
      <rect
        x={px(f.x)}
        y={pz(f.z)}
        width={f.width * echelle}
        height={f.depth * echelle}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
      />

      {etage.rooms.map((salle) => {
        const actif = salle.id === selection
        const aveugle = salle.keys.length === 0
        return (
          <g
            key={salle.id}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(salle.id)
            }}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={px(salle.footprint.x)}
              y={pz(salle.footprint.z)}
              width={salle.footprint.width * echelle}
              height={salle.footprint.depth * echelle}
              // Une galerie est hachurée plutôt que colorée : elle n'expose rien,
              // et la confondre avec une salle fausse la lecture du plan.
              fill={aveugle ? 'rgba(255,255,255,0.06)' : (COULEUR_THEME[salle.theme] ?? '#b8c6d0')}
              fillOpacity={aveugle ? 1 : 0.55}
              stroke={actif ? '#ffd479' : 'rgba(0,0,0,0.45)'}
              strokeWidth={actif ? 2.5 : 1}
            />
            <text
              x={px(salle.footprint.x + salle.footprint.width / 2)}
              y={pz(salle.footprint.z + salle.footprint.depth / 2)}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                fontFamily: 'system-ui, sans-serif',
                fontSize: 10,
                fontWeight: 500,
                fill: '#10141a',
                pointerEvents: 'none',
              }}
            >
              {aveugle ? '—' : `${salle.name} · ${salle.keys.length}`}
            </text>
          </g>
        )
      })}

      {/* La trémie, pour situer l'anneau. Le niveau le plus bas n'en a pas. */}
      {etage.slabHoles.length > 0 && (
        <rect
          x={px(atrium.x)}
          y={pz(atrium.z)}
          width={atrium.width * echelle}
          height={atrium.depth * echelle}
          fill="rgba(0,0,0,0.35)"
          stroke="rgba(255,255,255,0.2)"
          strokeDasharray="4 3"
        />
      )}
    </svg>
  )
}

// ── Le panneau de propriétés ─────────────────────────────────────────────

function ProprietesSalle({
  salle,
  override,
  niveaux,
  onChange,
}: {
  salle: Room
  override: { name?: string; theme?: string; floor?: number; order?: number; hidden?: boolean }
  niveaux: number[]
  onChange: (patch: Record<string, unknown>) => void
}) {
  return (
    <section style={{ display: 'grid', gap: '0.5rem' }}>
      <div style={{ opacity: 0.6, fontSize: '0.78rem' }}>
        <code>{salle.id}</code> · {salle.keys.length} œuvre{salle.keys.length > 1 ? 's' : ''}
        {salle.topics.length > 0 && ` · ${salle.topics.join(', ')}`}
      </div>

      <label style={LABEL}>
        Nom
        <input
          value={override.name ?? ''}
          placeholder={salle.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={CHAMP}
        />
      </label>

      <label style={LABEL}>
        Thème
        <select
          value={override.theme ?? salle.theme}
          onChange={(e) => onChange({ theme: e.target.value })}
          style={CHAMP}
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label style={LABEL}>
        Étage
        <select
          value={override.floor ?? ''}
          onChange={(e) => onChange({ floor: e.target.value === '' ? undefined : Number(e.target.value) })}
          style={CHAMP}
        >
          <option value="">(celui que le générateur choisit)</option>
          {niveaux.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.5 }}>
        Un champ vidé RETIRE l’override : la salle reprend ce que le générateur décide.
        C’est ce qui permet de revenir en arrière sans éditer le JSON à la main.
      </p>
    </section>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────

const BOUTON: React.CSSProperties = {
  padding: '0.35rem 0.6rem',
  fontFamily: 'system-ui, sans-serif',
  fontSize: '0.78rem',
  fontWeight: 500,
  lineHeight: 1,
  background: 'rgba(255,255,255,0.08)',
  color: 'inherit',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 3,
  cursor: 'pointer',
}

const BOUTON_ACTIF: React.CSSProperties = {
  background: 'rgba(255,212,121,0.22)',
  borderColor: 'rgba(255,212,121,0.5)',
}

const BOUTON_FORT: React.CSSProperties = {
  background: '#3d6ea5',
  borderColor: '#5b8ac2',
}

const LABEL: React.CSSProperties = {
  display: 'grid',
  gap: '0.2rem',
  fontSize: '0.78rem',
  opacity: 0.9,
}

const CHAMP: React.CSSProperties = {
  padding: '0.35rem 0.45rem',
  fontFamily: 'system-ui, sans-serif',
  fontSize: '0.82rem',
  fontWeight: 400,
  lineHeight: 1.2,
  background: 'rgba(255,255,255,0.06)',
  color: 'inherit',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 3,
}

const ALERTE: React.CSSProperties = {
  margin: 0,
  padding: '0.5rem 0.6rem',
  background: 'rgba(255,120,90,0.12)',
  border: '1px solid rgba(255,120,90,0.3)',
  borderRadius: 3,
  fontSize: '0.8rem',
}
