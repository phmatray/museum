/**
 * Les aides de l'interface native (vague 5), sans React ni Babylon :
 * `el`/`svg` créent un élément (textes par textContent : jamais de donnée du
 * catalogue en innerHTML), `observer` suit une part d'un store zustand/vanilla,
 * `themeName` nomme une salle comme hooks/useAccrochage (qui tire React).
 */
import type { Accrochage } from '../../plan/hang.ts'

type Attributs = Record<string, string | number | boolean | null | undefined>
type Enfant = Node | string | null | undefined | false

/** Pose les attributs (`false`/null/undefined : absent, `true` : présent vide) puis ajoute les enfants. */
function garnir<E extends Element>(e: E, attrs: Attributs, enfants: Enfant[]): E {
  for (const [k, v] of Object.entries(attrs)) if (v !== false && v != null) e.setAttribute(k, v === true ? '' : String(v))
  for (const c of enfants) if (c || c === '') e.append(c)
  return e
}

/** `el('button', { type: 'button', 'aria-label': 'Son' }, 'Son')`. `class` et `style` sont des attributs comme les autres. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attributs = {}, ...enfants: Enfant[]): HTMLElementTagNameMap[K] {
  return garnir(document.createElement(tag), attrs, enfants)
}

/** `svg('circle', { cx: 4, cy: 4, r: 2 })` : dans l'espace de noms SVG. */
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attributs = {}, ...enfants: Enfant[]): SVGElementTagNameMap[K] {
  return garnir(document.createElementNS('http://www.w3.org/2000/svg', tag), attrs, enfants)
}

/**
 * Appelle `f` tout de suite puis chaque fois que `choisir(état)` change
 * (Object.is, ou membre à membre pour un tableau) ; rend le désabonnement.
 */
export function observer<S, T>(store: { getState(): S; subscribe(f: (s: S) => void): () => void }, choisir: (s: S) => T, f: (v: T) => void): () => void {
  let v = choisir(store.getState())
  f(v)
  return store.subscribe((s) => {
    const n = choisir(s)
    const pareil = Array.isArray(n) && Array.isArray(v) ? n.length === v.length && n.every((x, i) => Object.is(x, (v as unknown[])[i])) : Object.is(n, v)
    if (pareil) return
    v = n
    f(n)
  })
}

/** Le thème de la salle dans l'accrochage, sinon `repli` (son nom de travail). */
export function themeName(accrochage: Accrochage | null, roomId: string, level: number, repli: string): string {
  return accrochage?.rooms.find((r) => r.id === roomId && r.level === level)?.name ?? repli
}
