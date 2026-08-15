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
| `bavette.glb` | `Bavette Catnap Texture.glb` (80 Mo) | `9f917aa4b25ea102f6dbf545ca9290c3a313a1c5a3436a28941934ca80c581cf` | Meshy (`meshy-scene`), à partir d'une photographie de Philippe Matray | © Philippe Matray — tous droits réservés |

## Reconstruire

```bash
blender --background --python tools/blender/build-sculptures.py -- \
  bavette "/chemin/vers/Bavette Catnap Texture.glb"
```

Le budget de triangles et la cote des cartes vivent dans `PIECES`, en tête du
script, avec la mesure qui les justifie.
