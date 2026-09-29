# Sources des pièces en volume

Les GLB de ce dossier sont **commités** : ils sont produits par des scripts
Blender (`tools/blender/`), et la CI n'a pas Blender. C'est la même exception
que le kit de props et les LOD de végétation.

Leurs SOURCES, en revanche, ne sont pas versionnées. Le dépôt est public et
elles pèsent des dizaines de mégaoctets. La reproductibilité est donc
**conditionnelle** : rejouable à condition de disposer du fichier source, et ce
tableau dit exactement lequel.

| Pièce | Fichier source | SHA-256 | Provenance | Licence |
|---|---|---|---|---|
| `bavette-anime.glb` | `Bavette Meshy profil.glb` (16 Mo) | `2bbef6a700518fc15aff0767ce3d649a8554b9df47ffe458a65e8337c1d6e8c6` | La photographie de Bavette debout par Philippe Matray (septembre 2026), redessinée de profil strict, tête dans l'axe, par Meshy image-to-image (`nano-banana-pro`), puis remontée en volume par Meshy image-to-3D (`latest`, 60 000 triangles, textures PBR). Squelette de quadrupède, poids et animations : `build-bavette-anime.py`. Remplace la pièce sur socle `bavette.glb`, tête tournée par-dessus l'épaule, inanimable. | © Philippe Matray — tous droits réservés |
| `chandelles.glb` | `i3d-chandelles-v2.glb` (9 Mo) | `cda4b69e08d7fd6782748044abf95435903ed58f1e7841fc1b9b8f6c810e6600` | Image Nano Banana Pro (choisie parmi trois : blocs massifs de section carrée, bronze poli uni), remontée par Meshy image → 3D (`latest`, 40 000 triangles, PBR). Prompt dans `tools/fetch-assets.ts`. Remplace la première version (`i3d-chandelles.glb`), plate vue de biais et marbrée de près ; les essais texte → 3D donnaient des bâtons bruns, puis une applique à bougies. | © Philippe Matray — tous droits réservés |
| `formulaire.glb` | `formulaire-v2.glb` (≈ 10 Mo) | `1978cd005c0cf2e65a69d1fbed75302d44ec3b4c5d73914b14c74c1fdd425a37` | Meshy texte → 3D (`latest`, 40 000 triangles, refine PBR), bronze poli, dans l'esprit de Gabo et Hepworth. | © Philippe Matray — tous droits réservés |
| `arborescence.glb` | `i3d-arborescence.glb` (10 Mo) | `0a0b8d4a7d113cdf1aea449d9e3c53b63857e48f52e3ebc08853f548c2515624` | Image Nano Banana Pro (`nb-arborescence-1.png` : un arbre à angles droits dont chaque branche finit en dossier), remontée par Meshy image → 3D (`latest`, 40 000 triangles, PBR). Remplace l'arbre organique du texte → 3D, trop grêle. | © Philippe Matray — tous droits réservés |

## Reconstruire

```bash
blender --background --python tools/blender/build-bavette-anime.py -- \
  "/chemin/vers/Bavette Meshy profil.glb"
```

Le budget de triangles, l'échelle, les os et les réglages de la marche vivent
en tête du script, avec les mesures qui les justifient :

- l'échelle, sur les mesures de Bavette prises par Philippe (30 cm au garrot,
  45–50 cm du museau à la base de la queue, queue de 20–30 cm) ; le script
  les vérifie à chaque construction (`BAVETTE_MESURES`) ;
- la marche (cycle, foulée, vitesse, ordre des pattes, durée des vols, port
  de la tête et de la queue), relevée image par image sur une vidéo de
  Bavette marchant de profil dans l'herbe (septembre 2026, non versionnée,
  © Philippe Matray). `BAVETTE_IK` dit de combien une patte manque sa cible.

`tools/blender/build-sculptures.py` reste l'outil des pièces STATIQUES qu'une
config déclare dans `sculptures` — dans le musée publié, les trois bronzes des
vitrines de la salle d'honneur :

```bash
blender --background --python tools/blender/build-sculptures.py -- chandelles /chemin/vers/i3d-chandelles-v2.glb
```
