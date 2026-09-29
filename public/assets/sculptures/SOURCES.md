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
| `chandelles.glb` | `talib2.glb` (9,3 Mo) | `c2449e8b79bb43a09154ab4675fbcd8d2260d7fc1445133de7341feb57b9d7c3` | Meshy texte → 3D (`latest`, 40 000 triangles, refine PBR), bronze patiné ; prompt complet dans `tools/fetch-assets.ts`. Second essai : le premier, des barres à mèches serrées en bloc, se lisait comme une masse brune. | © Philippe Matray — tous droits réservés |
| `formulaire.glb` | `formcraft.glb` (7,0 Mo) | `5384095c42531240980fa55d76a63435af2d4a1305256b31fdc13e2684a9d44b` | Meshy texte → 3D (`latest`, 40 000 triangles, refine PBR), bronze patiné. | © Philippe Matray — tous droits réservés |
| `arborescence.glb` | `vfs.glb` (9,4 Mo) | `8421e6684f5ef790fa29bb347527255c71aac6c8ceaf28b10a31e7a5f036b6bd` | Meshy texte → 3D (`latest`, 40 000 triangles, refine PBR), bronze patiné. | © Philippe Matray — tous droits réservés |

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
blender --background --python tools/blender/build-sculptures.py -- chandelles /chemin/vers/talib2.glb
```
