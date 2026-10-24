---
name: signalement
description: Corriger un bug visuel signalé par le bouton 🐞 du musée (`npm run dev`) — `/signalement <id>` : worktree `bug/<id>`, reproduction headless, cause racine, avant/après, rapport, commit, puis le correctif servi sur :5173 (worktree `recette`). Utilise-le dès qu'un message commence par `/signalement` ou cite un dossier `.signalement/<id>/`.
---

# Corriger un bug signalé par le bouton 🐞

Travaille seul jusqu'au bout : personne ne répondra avant la fin. L'argument est l'`id` du constat (12 chiffres).

`P` = le checkout principal (`git rev-parse --git-common-dir`, son parent) ; `D` = `P/.signalement/<id>/`. Les captures
et le rapport vont dans `D`, jamais dans un worktree.

## 1. Le constat

Lis `D/signalement.json` (note, `lieu` avec sa `surface`, `trajet`, `heure`, `q`, `taille`, `moteur`, `racine` et `sha`
servis, `sale`) et regarde `D/utilisateur.png`. `sale: true` : la racine servie avait des modifications non commitées,
absentes de `sha` ; si le bug en dépend, dis-le dans le rapport.

## 2. Préparer

```bash
node <racine>/tools/preparer-signalement.ts <id>    # → { worktree, port, constat }
```

Il crée `P/.claude/worktrees/bug-<id>` (branche `bug/<id>`, depuis `sha`), y recopie `node_modules` et les assets non
versionnés, et choisit un port libre. Lance tout de suite, en tâche de fond, dans le worktree :
`npx vite --port <port> --strictPort` (s'il est pris entre-temps, relance le script). Puis lis le CLAUDE.md du worktree.
Toutes les commandes suivantes se lancent depuis le worktree. Sur macOS :
`export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

## 3. Avant, sans toucher au code

```bash
node tools/comparer-captures.ts http://localhost:<port>/ --signalement=<id>               # D/avant/lieu.png, trajet-*.png
node tools/comparer-captures.ts http://localhost:<port>/ --signalement=<id> --vues=a,b    # 2-3 vues voisines de VUES
```

`lieu.png` doit montrer la vue du visiteur au GPU près. Sinon cherche ce qui manque (heure, météo, saison, `?gpu=0` si
`moteur` est WebGL2) ; si tu n'y arrives pas, arrête-toi et écris un rapport « non reproduit ». Entre deux points du
trajet, un élément qui apparaît ou disparaît désigne ce qu'il faut chercher : ce qui décide de l'afficher là.
D'autres poses à toi (un profil, un gros plan) : `--lieu=x,z,y,yaw,pitch[;…] --nom=<nom> --heure=… --q='…'
--taille=LxH --dossier=D/avant` (une pose sur une volée est acceptée).

## 4. Corriger

La cause racine, pas le symptôme, à la source, selon CLAUDE.md (le plan d'abord, deux surfaces sur le même plan,
greffes GLSL **et** WGSL…). Mesure avant de supposer : une sonde headless (puppeteer + `window.__BABYLON__`, modules
`/src/...` importés dans la page) vaut mieux qu'une hypothèse. Blender, un nouveau bake de la lumière ou une décision de
design : ne le fais pas, décris-le dans le rapport.

`npm run lint`, `npx tsc -b`, puis les tests concernés : `npx vitest run <fichiers>` (sous Node ≥ 26 seulement,
préfixe `NODE_OPTIONS=--no-webstorage` ; Node 24 le refuse). Un test de durée qui échoue pendant que des captures
chargent la machine : relance-le seul avant de conclure.

## 5. Après

Les mêmes commandes avec `--apres` : elles écrivent `D/apres/`, affichent l'écart moyen par vue et
`D/apres/<vue>.avant-apres.png` (avant à gauche). Regarde ces images toi-même : le bug a disparu de `lieu`, les voisines
n'ont pas bougé sauf changement voulu (deux captures du même code diffèrent déjà d'environ 0,5). Sinon reprends à 4,
trois essais au plus. Une capture « avant » oubliée après avoir modifié le code : remets les originaux le temps de la
capture (`git show HEAD:<fichier> > <fichier>`, puis ta version), jamais `git checkout -- <fichier>`.

## 6. Rapport et commit

`D/rapport.md` : verdict (corrigé / partiel / non reproduit), cause, correctif (fichiers), écarts mesurés, images
(chemins relatifs à `D`), ce qui reste douteux.

Commit sur `bug/<id>`, en français : `fix(<zone>): …`. Si un hook refuse `git commit` (la garde d'écriture git),
passe par le script qu'il nomme. Ni push ni PR : le propriétaire regarde l'avant/après d'abord. Arrête ton serveur.

## 7. Servir le correctif sur :5173

Sauf avis contraire du propriétaire, le correctif rejoint ceux qui attendent sa validation, servis sur :5173 :

```bash
R=P/.claude/worktrees/recette
[ -d "$R" ] || node <racine>/tools/preparer-signalement.ts --recette
git -C "$R" cherry-pick <commit de bug/<id>>
lsof -tiTCP:5173 -sTCP:LISTEN | xargs kill      # puis, en tâche de fond, dans $R :
npx vite --port 5173 --strictPort
curl -s http://localhost:5173/<un fichier modifié> | grep <ce qui a changé>   # servi ?
```

Une intégration à la fois. Un conflit de cherry-pick : résous-le s'il est évident, sinon laisse la recette telle quelle
et dis-le.

## Plusieurs constats à la fois

Un constat qui arrive pendant une correction : confie-le à un sous-agent avec `/signalement <id>`. Chacun a son
worktree et son port ; seule l'étape 7 se fait l'un après l'autre.

## Pièges connus

- zsh ne découpe pas une variable non citée : `$A` qui contient plusieurs options passe un seul argument. Écris-les.
- Un worktree supprimé emporte ce qu'il contient : d'où `D` dans le checkout principal.
- Pour le rapport final au propriétaire : le verdict d'abord, puis la cause en une phrase, ce qui est servi sur :5173,
  et les décisions qui lui reviennent.
