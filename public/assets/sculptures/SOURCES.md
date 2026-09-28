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

## Reconstruire

```bash
blender --background --python tools/blender/build-bavette-anime.py -- \
  "/chemin/vers/Bavette Meshy profil.glb"
```

Le budget de triangles, la hauteur, les os et les réglages de la marche vivent
en tête du script, avec les mesures qui les justifient.

`tools/blender/build-sculptures.py` reste l'outil des pièces STATIQUES qu'une
config déclare dans `sculptures` (aucune dans le musée publié).
