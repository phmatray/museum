/**
 * Prépare la correction d'un bug signalé par le bouton 🐞 (skill `.claude/skills/signalement`) :
 *
 *   node tools/preparer-signalement.ts <id>      le worktree `bug/<id>`, parti du commit servi au moment du constat
 *   node tools/preparer-signalement.ts --recette le worktree `recette` (branche `recette/signalements`, depuis main),
 *                                                où les correctifs s'accumulent pour être servis sur :5173
 *
 * Les worktrees vont sous `.claude/worktrees/` du checkout principal ; `node_modules` et les assets non versionnés
 * de `public/` y sont recopiés depuis la racine servie (clones APFS sur macOS, instantanés), chacun à son chemin :
 * `git ls-files --directory` rend des dossiers avec un `/` final, que `cp -R` vide dans le parent au lieu de les copier.
 * Rejouable : ce qui existe déjà est gardé. Sortie (JSON) : le worktree, un port libre pour son serveur, le constat.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

import { racinePrincipale } from './signalement.ts'

const arg = process.argv[2]
if (!arg) throw new Error('usage : node tools/preparer-signalement.ts <id> | --recette')
const principal = racinePrincipale(process.cwd())
const git = (...a: string[]) => execFileSync('git', a, { cwd: principal, encoding: 'utf8' }).trim()

const recette = arg === '--recette'
const constat = recette ? null : join(principal, '.signalement', arg)
const { racine, sha } = constat
  ? (JSON.parse(readFileSync(join(constat, 'signalement.json'), 'utf8')) as { racine: string; sha: string })
  : { racine: principal, sha: 'main' }
const worktree = join(principal, '.claude', 'worktrees', recette ? 'recette' : `bug-${arg}`)
if (!existsSync(worktree)) git('worktree', 'add', '-b', recette ? 'recette/signalements' : `bug/${arg}`, worktree, sha)

const copier = (chemin: string) => {
  const cible = join(worktree, chemin)
  if (existsSync(cible)) return
  mkdirSync(dirname(cible), { recursive: true })
  execFileSync('cp', [process.platform === 'darwin' ? '-cR' : '-R', join(racine, chemin), cible])
}
copier('node_modules')
const ignores = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', 'public'], { cwd: racine, encoding: 'utf8' })
for (const chemin of ignores.split('\n').filter(Boolean)) copier(chemin.replace(/\/$/, ''))

/** Le premier port libre au-dessus de 5180 (5173 est celui du visiteur) : un serveur par correction en cours. */
const libre = (p: number) => new Promise<boolean>((ok) => {
  const s = createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)))
  s.listen(p)
})
let port = 5180
while (!(await libre(port))) port++

console.log(JSON.stringify({ worktree, port: recette ? 5173 : port, constat }, null, 2))
