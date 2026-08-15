# Planche de relecture

Captures du musée, régénérées par :

```bash
npm run dev
node tools/capture.ts --url http://localhost:5173/
node tools/screenshots.ts
```

Elles sont ici pour qu'un chantier de RENDU se relise sans avoir à le rejouer : on ne juge pas un éclairage sur un tableau de chiffres, et refaire ces images demande Chrome, le serveur Vite et 345 Mo de sources de végétation.

Redimensionnées à 1440 px et encodées en WebP q80 — 1.30 Mo au total, contre 56 Mo de PNG bruts. Les originaux en 2880×1800 restent dans `.captures/`, qui n'est pas versionné.

## Budget §9, sur la vue la plus chère

| Poste | Relevé | Plafond | |
|---|--:|--:|---|
| calls | 263 | 150 | ✗ |
| triangles | 955 195 | 1 000 000 | ✓ |
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
| 263 | 955 195 | 0.07 % | 0.01 % | 137.6 | 34.4 |

### `exterieur`

![exterieur](exterieur.webp)

**Ce qu'elle prouve** — silhouette et façade : teinte unique, pas de bandeau de bois par niveau

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 260 | 954 815 | 0.01 % | 0 % | 144.1 | 48.5 |

### `atrium-plongee`

![atrium-plongee](atrium-plongee.webp)

**Ce qu'elle prouve** — la rampe vue de haut : garde-corps et sous-face du tablier

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 229 | 952 365 | 0 % | 0 % | 133 | 33.2 |

### `ligne-de-vue`

![ligne-de-vue](ligne-de-vue.webp)

**Ce qu'elle prouve** — traversée de l’atrium à hauteur d’œil : le vide doit rester un vide

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 254 | 954 599 | 0.1 % | 0 % | 139.9 | 45 |

### `atrium-nervures`

![atrium-nervures](atrium-nervures.webp)

**Ce qu'elle prouve** — les nervures d’atrium : de la structure sur trois niveaux, pas un bandeau flottant

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 247 | 954 047 | 0.04 % | 0 % | 169.9 | 38.8 |

### `coin`

![coin](coin.webp)

**Ce qu'elle prouve** — l'angle de salle : le SSAO doit y creuser un dégradé

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 161 | 809 735 | 0.98 % | 0 % | 113.5 | 27.2 |

### `coin-sans-postfx`

![coin-sans-postfx](coin-sans-postfx.webp)

**Ce qu'elle prouve** — même caméra, sans post-traitement : le témoin du A/B

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 105 | 809 036 | 2.95 % | 0.01 % | 122.8 | 27.7 |

### `escalier`

![escalier](escalier.webp)

**Ce qu'elle prouve** — l'escalier hélicoïdal : girons et contremarches, pas un plan incliné

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 250 | 954 071 | 0.1 % | 0 % | 143.9 | 41 |

### `fenetre`

![fenetre](fenetre.webp)

**Ce qu'elle prouve** — depuis un passage : la vue sur le parc, et la vitre qui la porte

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 138 | 804 947 | 0.03 % | 0 % | 118.2 | 38.7 |

### `palier`

![palier](palier.webp)

**Ce qu'elle prouve** — le palier : le garde-corps doit s'ouvrir devant la première marche

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 240 | 953 243 | 0.21 % | 0 % | 129.9 | 37.2 |

### `plafond`

![plafond](plafond.webp)

**Ce qu'elle prouve** — regard vers le haut : la sous-face de dalle doit être du béton clair

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 191 | 947 891 | 0 % | 0.02 % | 199.3 | 36.2 |
