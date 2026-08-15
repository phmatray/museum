# Planche de relecture

Captures du musée, régénérées par :

```bash
npm run dev
node tools/capture.ts --url http://localhost:5173/
node tools/screenshots.ts
```

Elles sont ici pour qu'un chantier de RENDU se relise sans avoir à le rejouer : on ne juge pas un éclairage sur un tableau de chiffres, et refaire ces images demande Chrome, le serveur Vite et 345 Mo de sources de végétation.

Redimensionnées à 1440 px et encodées en WebP q80 — 1.29 Mo au total, contre 56 Mo de PNG bruts. Les originaux en 2880×1800 restent dans `.captures/`, qui n'est pas versionné.

## Budget §9, sur la vue la plus chère

| Poste | Relevé | Plafond | |
|---|--:|--:|---|
| calls | 269 | 150 | ✗ |
| triangles | 964 099 | 1 000 000 | ✓ |
| lights | 12 | 12 | ✓ |
| shadowCasters | 1 | 2 | ✓ |

Le plafond de draw calls est dépassé, et il l'était avant ce chantier — le compteur est laissé rouge parce qu'il dit quelque chose de vrai. Le levier qui le fermerait est connu et non tiré : fusionner les murs d'un plateau par matière (71 murs, un appel chacun).

## Les plans cotés

Un par niveau, produits par `node tools/plan.ts`. Ils portent le mobilier, le décor et **les recouvrements**, cerclés de rouge.

Trait plein : ce qui est au sol, dans lequel on se cogne. Trait pointillé : ce qui est au-dessus de la tête et qu'on regarde par en dessous — c'est un plan de plafond réfléchi, et c'est la seule façon de voir un débord, qui par définition ne touche pas le sol.

### `plan-etage-1`

![plan-etage-1](plan-etage-1.png)

### `plan-etage-2`

![plan-etage-2](plan-etage-2.png)

### `plan-rdc`

![plan-rdc](plan-rdc.png)

### `plan-reserve`

![plan-reserve](plan-reserve.png)
## Les vues

### `entree`

![entree](entree.webp)

**Ce qu'elle prouve** — vue d'accueil : plus de masse noire, et le plafond n'est plus du parquet

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 269 | 964 099 | 0.07 % | 0.01 % | 140.5 | 31.9 |

### `exterieur`

![exterieur](exterieur.webp)

**Ce qu'elle prouve** — silhouette et façade : teinte unique, pas de bandeau de bois par niveau

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 266 | 963 719 | 0.01 % | 0 % | 155.7 | 42.2 |

### `atrium-plongee`

![atrium-plongee](atrium-plongee.webp)

**Ce qu'elle prouve** — la rampe vue de haut : garde-corps et sous-face du tablier

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 235 | 961 269 | 0 % | 0 % | 133.2 | 33.1 |

### `ligne-de-vue`

![ligne-de-vue](ligne-de-vue.webp)

**Ce qu'elle prouve** — traversée de l’atrium à hauteur d’œil : le vide doit rester un vide

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 260 | 963 503 | 0.1 % | 0 % | 144.3 | 41 |

### `atrium-nervures`

![atrium-nervures](atrium-nervures.webp)

**Ce qu'elle prouve** — les nervures d’atrium : de la structure sur trois niveaux, pas un bandeau flottant

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 253 | 962 951 | 0.04 % | 0 % | 173.3 | 33.2 |

### `coin`

![coin](coin.webp)

**Ce qu'elle prouve** — l'angle de salle : le SSAO doit y creuser un dégradé

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 167 | 818 639 | 0.97 % | 0 % | 139.2 | 39.9 |

### `coin-sans-postfx`

![coin-sans-postfx](coin-sans-postfx.webp)

**Ce qu'elle prouve** — même caméra, sans post-traitement : le témoin du A/B

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 111 | 817 940 | 2.95 % | 0.01 % | 146.3 | 40.2 |

### `escalier`

![escalier](escalier.webp)

**Ce qu'elle prouve** — l'escalier hélicoïdal : girons et contremarches, pas un plan incliné

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 256 | 962 975 | 0.1 % | 0 % | 147.6 | 37.4 |

### `fenetre`

![fenetre](fenetre.webp)

**Ce qu'elle prouve** — depuis un passage : la vue sur le parc, et la vitre qui la porte

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 144 | 813 851 | 0.03 % | 0 % | 172 | 58.9 |

### `palier`

![palier](palier.webp)

**Ce qu'elle prouve** — le palier : le garde-corps doit s'ouvrir devant la première marche

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 246 | 962 147 | 0.21 % | 0 % | 133.7 | 34.2 |

### `plafond`

![plafond](plafond.webp)

**Ce qu'elle prouve** — regard vers le haut : la sous-face de dalle doit être du béton clair

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 197 | 956 795 | 0 % | 0.02 % | 199.3 | 36.2 |
