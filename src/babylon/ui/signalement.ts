/**
 * Outil de dév, absent du build (importé sous `import.meta.env.DEV`, main.ts) : la touche B ou le bouton 🐞
 * photographient la vue, puis l'envoient avec une note et la pose exacte du visiteur au serveur de dév
 * (`tools/signalement.ts`), qui range le constat et rend un prompt prêt : on le copie dans la session Claude
 * de son choix, qui corrige dans un worktree, captures avant/après à l'appui. Rien ne se lance tout seul.
 */
import { CreateScreenshotAsync } from '@babylonjs/core/Misc/screenshotTools'
import type { Scene } from '@babylonjs/core/scene'

import { requeteDeReprise, type PoseTrajet } from '../../domain/signalement.ts'
import { heureDemandee } from '../../domain/soleil.ts'
import { partie, recherche, vivant } from '../etat.ts'
import type { monterVisiteur } from '../visiteur.ts'
import { el } from './dom.ts'
import './signalement.css'

const deux = (n: number) => String(n).padStart(2, '0')

export function monterSignalement(scene: Scene, camera: ReturnType<typeof monterVisiteur>): void {
  const engine = scene.getEngine()
  const apercu = el('img', { alt: 'La vue capturée' })
  const note = el('textarea', { rows: 4, required: true, placeholder: 'Ce qui cloche, et où le voir dans l’image…' })
  const envoyer = el('button', { type: 'submit' }, 'Préparer le prompt')
  const fermer = el('button', { type: 'button' }, 'Fermer')
  const etat = el('p', { class: 'signalement-etat', role: 'status' })
  // Le prompt rendu par le serveur, à copier dans une session Claude : lisible, sélectionnable, jamais exécuté d'ici.
  const prompt = el('textarea', { class: 'signalement-prompt', rows: 8, readonly: true, 'aria-label': 'Le prompt à copier' })
  const copier = el('button', { type: 'button' }, 'Copier')
  const rendu = el('div', { class: 'signalement-rendu', hidden: true }, prompt, el('div', { class: 'signalement-actions' }, copier))
  const formulaire = el('form', {}, el('h2', {}, 'Signaler un bug visuel'), apercu, note, el('div', { class: 'signalement-actions' }, fermer, envoyer), etat, rendu)
  const dialogue = el('dialog', { class: 'signalement' }, formulaire)
  const bouton = el('button', { type: 'button', class: 'signaler', title: 'Signaler un bug visuel à Claude (B)', 'aria-label': 'Signaler un bug visuel' }, '🐞')
  // Hors des captures pilotées (comparer-captures, mesurer-rendu) : la touche B suffit.
  bouton.hidden = navigator.webdriver
  document.body.append(bouton, dialogue)
  // Les touches du musée (M, R, C…) ne doivent pas réagir à la frappe de la note.
  dialogue.addEventListener('keydown', (e) => e.stopPropagation())

  // Les 6 dernières secondes de marche, une pose toutes les 250 ms : un bug qui n'apparaît qu'en bougeant
  // (un objet qui clignote dans l'escalier) se rejoue sur le trajet, pas sur la seule image finale.
  const trajet: PoseTrajet[] = []
  let derniere = 0
  scene.onAfterRenderObservable.add(() => {
    const t = performance.now()
    if (t - derniere < 250 || dialogue.open) return
    derniere = t
    const w = camera.walker()
    trajet.push({ x: w.x, z: w.z, y: w.y, yaw: camera.rotation.y, pitch: camera.rotation.x, t })
    if (trajet.length > 24) trajet.shift()
  })

  let constat: Record<string, unknown> = {}
  const ouvrir = async () => {
    if (dialogue.open) return
    // L'image d'abord, telle que vue, avant la pause et le dialogue.
    const image = await CreateScreenshotAsync(engine, camera, { precision: 1 })
    const d = heureDemandee(recherche(), new Date()) ?? new Date()
    const { meteo } = vivant.getState()
    const maintenant = performance.now()
    constat = {
      image,
      adresse: location.href,
      lieu: { ...camera.walker(), yaw: camera.rotation.y, pitch: camera.rotation.x },
      heure: `${deux(d.getHours())}:${deux(d.getMinutes())}`,
      q: requeteDeReprise(recherche(), meteo, engine.isWebGPU),
      meteo,
      moteur: engine.isWebGPU ? 'WebGPU' : 'WebGL2',
      taille: [engine.getRenderWidth(), engine.getRenderHeight()],
      trajet: trajet.map((p) => ({ ...p, t: Math.round(p.t - maintenant) / 1000 })),
    }
    apercu.src = image
    etat.textContent = ''
    envoyer.disabled = false
    rendu.hidden = true
    // La visite s'arrête pendant la note, comme sur Échap (sans verrou du pointeur, rien ne la mettrait en pause).
    document.exitPointerLock?.()
    partie.setState({ paused: true })
    dialogue.showModal()
    note.focus()
  }

  formulaire.addEventListener('submit', async (e) => {
    e.preventDefault()
    envoyer.disabled = true
    etat.textContent = 'Préparation du constat…'
    try {
      const r = await fetch('/__signalement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...constat, note: note.value }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erreur ?? r.statusText)
      etat.textContent = `Constat rangé dans ${j.dossier}. Colle ce prompt dans la session Claude de ton choix :`
      prompt.value = j.prompt
      rendu.hidden = false
      note.value = ''
    } catch (err) {
      etat.textContent = `Échec : ${err instanceof Error ? err.message : err}`
      envoyer.disabled = false
    }
  })
  fermer.addEventListener('click', () => dialogue.close())
  // Dans le geste du clic : le presse-papiers l'exige.
  copier.addEventListener('click', () => {
    navigator.clipboard.writeText(prompt.value).then(
      () => (copier.textContent = 'Copié'),
      () => {
        prompt.select()
        copier.textContent = 'Sélectionné : ⌘C'
      },
    )
    setTimeout(() => (copier.textContent = 'Copier'), 2000)
  })
  bouton.addEventListener('click', (e) => {
    e.stopPropagation()
    void ouvrir()
  })
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyB' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLInputElement)) void ouvrir()
  })
}
