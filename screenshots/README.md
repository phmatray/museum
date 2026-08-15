# Planche de relecture

Captures du musée, régénérées par :

```bash
npm run dev
node tools/capture.ts --url http://localhost:5173/
node tools/screenshots.ts
```

Elles sont ici pour qu'un chantier de RENDU se relise sans avoir à le rejouer : on ne juge pas un éclairage sur un tableau de chiffres, et refaire ces images demande Chrome, le serveur Vite et 345 Mo de sources de végétation.

Redimensionnées à 1440 px et encodées en WebP q80 — 1.00 Mo au total, contre 56 Mo de PNG bruts. Les originaux en 2880×1800 restent dans `.captures/`, qui n'est pas versionné.

## Budget §9, sur la vue la plus chère

| Poste | Relevé | Plafond | |
|---|--:|--:|---|
| calls | 260 | 150 | ✗ |
| triangles | 920 705 | 1 000 000 | ✓ |
| lights | 12 | 12 | ✓ |
| shadowCasters | 1 | 2 | ✓ |

Le plafond de draw calls est dépassé, et il l'était avant ce chantier — le compteur est laissé rouge parce qu'il dit quelque chose de vrai. Le levier qui le fermerait est connu et non tiré : fusionner les murs d'un plateau par matière (71 murs, un appel chacun).

## Les vues

### `entree`

![entree](entree.webp)

**Ce qu'elle prouve** — vue d'accueil : plus de masse noire, et le plafond n'est plus du parquet

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 260 | 920 705 | 0.21 % | 0 % | 143.3 | 33.1 |

### `exterieur`

![exterieur](exterieur.webp)

**Ce qu'elle prouve** — silhouette et façade : teinte unique, pas de bandeau de bois par niveau

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 257 | 920 325 | 0.01 % | 0 % | 150.6 | 46.4 |

### `atrium-plongee`

![atrium-plongee](atrium-plongee.webp)

**Ce qu'elle prouve** — la rampe vue de haut : garde-corps et sous-face du tablier

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 226 | 917 875 | 0 % | 0 % | 146.6 | 34 |

### `atrium-nervures`

![atrium-nervures](atrium-nervures.webp)

**Ce qu'elle prouve** — les nervures d’atrium : de la structure sur trois niveaux, pas un bandeau flottant

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 242 | 919 441 | 0.05 % | 0 % | 178.9 | 37.6 |

### `coin`

![coin](coin.webp)

**Ce qu'elle prouve** — l'angle de salle : le SSAO doit y creuser un dégradé

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 158 | 831 245 | 1.13 % | 0 % | 125.4 | 27.8 |

### `coin-sans-postfx`

![coin-sans-postfx](coin-sans-postfx.webp)

**Ce qu'elle prouve** — même caméra, sans post-traitement : le témoin du A/B

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 103 | 830 804 | 0.62 % | 0.09 % | 134.7 | 22.8 |

### `escalier`

![escalier](escalier.webp)

**Ce qu'elle prouve** — l'escalier hélicoïdal : girons et contremarches, pas un plan incliné

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 247 | 919 581 | 0.17 % | 0 % | 157.8 | 35.7 |

### `fenetre`

![fenetre](fenetre.webp)

**Ce qu'elle prouve** — depuis un passage : la vue sur le parc, et la vitre qui la porte

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 135 | 826 457 | 0.03 % | 0 % | 129.9 | 42.3 |

### `palier`

![palier](palier.webp)

**Ce qu'elle prouve** — le palier : le garde-corps doit s'ouvrir devant la première marche

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 237 | 918 753 | 0.47 % | 0 % | 139.9 | 34.6 |

### `plafond`

![plafond](plafond.webp)

**Ce qu'elle prouve** — regard vers le haut : la sous-face de dalle doit être du béton clair

| draw calls | triangles | noir < 25 | blanc > 250 | luminance | σ |
|--:|--:|--:|--:|--:|--:|
| 188 | 913 401 | 0 % | 2.59 % | 204.4 | 33.5 |
