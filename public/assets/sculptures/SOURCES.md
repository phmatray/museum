# Sources des pièces en volume

Les GLB de ce dossier sont **commités** : ils sont produits par
`tools/blender/build-sculptures.py`, et la CI n'a pas Blender. C'est la même
exception que le kit de props et les LOD de végétation.

Leurs SOURCES, en revanche, ne sont pas versionnées. Le dépôt est public et
elles pèsent des dizaines de mégaoctets. La reproductibilité est donc
**conditionnelle** : rejouable à condition de disposer du fichier source, et ce
tableau dit exactement lequel.

| Pièce | Fichier source | SHA-256 | Provenance | Licence |
|---|---|---|---|---|
| `bavette.glb` | `Bavette Meshy image-to-3d.glb` (13 Mo) | `cca8bfb191e82d9c8ba9b5cc0b7b3ede2488722a94f50baa5858c356dc0cb1a3` | Meshy image-to-3D (`latest`, 60 000 triangles, textures PBR), à partir d'une photographie de Bavette debout par Philippe Matray (septembre 2026) ; remplace la version endormie `Bavette Catnap Texture.glb` | © Philippe Matray — tous droits réservés |

## Reconstruire

```bash
blender --background --python tools/blender/build-sculptures.py -- \
  bavette "/chemin/vers/Bavette Meshy image-to-3d.glb"
```

Le budget de triangles et la cote des cartes vivent dans `PIECES`, en tête du
script, avec la mesure qui les justifie.
