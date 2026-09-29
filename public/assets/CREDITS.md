# Assets

Les assets **récupérés** — matières, HDRI, végétation — sont tous en CC0
(domaine public). Aucune attribution n'est requise ; elle est donnée par
correction et pour documenter la provenance.

Les **pièces en volume** de `sculptures/` n'en font pas partie : ce sont des
œuvres de l'auteur du musée, tous droits réservés. Leur provenance et leur
licence sont dans `sculptures/SOURCES.md`.

Récupérés par `node tools/fetch-assets.ts`, non versionnés — sauf les LOD de
végétation, le kit de props, la nef, le jardin et les pièces en volume, qui exigent
Blender et sont donc commités.

| Asset | Source | Licence | Usage |
|---|---|---|---|
| Concrete034 | ambientCG | CC0 | murs extérieurs, dalles, rampes |
| Plaster001 | ambientCG | CC0 | murs de salle, thème classic |
| PaintedPlaster017 | ambientCG | CC0 | murs de salle, thème modern |
| WoodFloor007 | ambientCG | CC0 | sols des salles |
| Terrazzo005 | ambientCG | CC0 | sol du rez-de-chaussée et de l’atrium |
| Metal032 | ambientCG | CC0 | mains courantes, cadres |
| Grass004 | ambientCG | CC0 | pelouse du parc |
| Gravel023 | ambientCG | CC0 | allées et parvis du parc |
| Rock044 | ambientCG | CC0 | dalles irrégulières et pas japonais près de l’eau |
| brown_photostudio_02 | Poly Haven | CC0 | carte d'environnement, spéculaire |
| kloofendal_48d_partly_cloudy_puresky | Poly Haven | CC0 | ciel du fond de scène, réduit en JPG |
| rogland_clear_night | Poly Haven | CC0 | ciel de nuit, réduit en JPG |
| potted_plant_02 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| potted_plant_04 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| calathea_orbifolia_01 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| anthurium_botany_01 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| island_tree_01 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| island_tree_02 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| jacaranda_tree | Poly Haven | CC0 | végétation, décimée dans les LOD |
| shrub_01 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| shrub_03 | Poly Haven | CC0 | végétation, décimée dans les LOD |
| rock_moss_set_01 | Poly Haven | CC0 | jardin japonais, décimé dans jardin.glb |
| rock_moss_set_02 | Poly Haven | CC0 | jardin japonais, décimé dans jardin.glb |
| boulder_01 | Poly Haven | CC0 | jardin japonais, décimé dans jardin.glb |
| fern_02 | Poly Haven | CC0 | jardin japonais, décimé dans jardin.glb |
| bavette-anime | Meshy, d'après une photo de l'auteur ; squelette et animations `tools/blender/build-bavette-anime.py` | © tous droits réservés | le chat Bavette, qui se promène dans le musée et le jardin |
| chandelles | Meshy (généré par IA) : image Nano Banana Pro puis image → 3D (textures PBR), prompt : « Product photograph of a single museum-grade abstract bronze sculpture… clean, smooth, uniformly polished warm golden bronze… no mottling, no streaks, no marbling… Solid, heavy, cast-metal volumes… five candlestick-chart candles standing in a row on one long thick solid rectangular bronze base, each candle a chunky solid bronze column of square cross-section, as deep as it is wide, with a sturdy round rod wick above and below it… set at progressively higher positions from left to right like an upward market trend… slightly staggered in depth » ; `tools/blender/build-sculptures.py` | © tous droits réservés | sculpture de la vitrine TaLibStandard, salle d'honneur |
| formulaire | Meshy (généré par IA, texte → 3D, textures PBR), prompt : « Museum-grade abstract bronze sculpture in the style of Naum Gabo and Barbara Hepworth: a graceful vertical composition of thin polished bronze rectangular plates like form input fields, cantilevered around a slender central spine in a gentle rising spiral, with a few small open square frames like checkboxes, one holding a subtle tick mark… » ; `tools/blender/build-sculptures.py` | © tous droits réservés | sculpture de la vitrine FormCraft, salle d'honneur |
| arborescence | Meshy (généré par IA) : image Nano Banana Pro puis image → 3D (textures PBR), prompt : « Product photograph of a single museum-grade abstract bronze sculpture… polished warm golden bronze… dark brown-green patina in the recesses… a stylised tree whose trunk branches strictly at right angles into a hierarchy like a file directory tree, each branch ending in a small flat bronze tablet shaped like a closed folder with a tab » ; `tools/blender/build-sculptures.py` | © tous droits réservés | sculpture de la vitrine VirtualFileSystem, salle d'honneur |
| PT Sans | Google Fonts (ParaType) | SIL OFL 1.1 | cartels et noms de salle (<Text> troika/drei) |
| PT Serif | Google Fonts (ParaType), sous-ensemble latin | SIL OFL 1.1 | titres des vitrines de la salle d'honneur et de leur borne |
| nef | `tools/blender/build-nef.py`, d'après le musée d'Orsay | œuvre originale du dépôt | voûte, verrière, horloge et lanternes du hall |
| batllo | `tools/blender/build-batllo.py`, d'après la Casa Batlló de Gaudí | œuvre originale du dépôt | baie de la salle d'honneur : colonnes en os, chêne ondulé, vitrail de cives |
| escalier | `tools/blender/build-escalier.py`, d'après le Grand Escalier de l'Opéra Garnier | œuvre originale du dépôt | l'escalier impérial de marbre : volées, bulbes du départ, limons et palier |
| chambranle | `tools/blender/build-chambranle.py`, d'après les portes des salles d'Orsay et du Louvre | œuvre originale du dépôt | chambranles moulurés, plinthes et entablements de pierre des portes |
| jardin | `tools/blender/build-jardin.py`, d'après le jardin japonais de Hasselt | œuvre originale du dépôt | étang, ruisseau, pont, lanterne, érables du Japon et boules taillées du parc |
| salle-honneur | `tools/blender/build-salle-honneur.py`, d'après l'étage noble de la Casa Batlló de Gaudí | œuvre originale du dépôt | salle d'honneur : voûte en tourbillon, lampe-soleil, pilastres en os, lambris et portes de chêne, parquet |
| vitrines | `tools/blender/build-vitrines.py`, d'après les panneaux du musée Cernuschi | œuvre originale du dépôt | vitrines de la salle d'honneur : panneau bordeaux, cadre doré sculpté, borne interactive |
| mobilier | `tools/blender/build-mobilier.py`, d'après les banquettes du Louvre, la nef d'Orsay et le banc double de la Casa Batlló de Gaudí | œuvre originale du dépôt | banquettes capitonnées des galeries, bancs de la nef, banque d'accueil, bancs Batlló de la salle d'honneur, bancs de granit et de cèdre du jardin |
| accessoires | Meshy (généré par IA, texte → 3D, texture PBR), mis à l’échelle et allégé par `tools/blender/build-accessoires.py` ; prompts : « a single museum stanchion post, polished brass, round weighted base, 95 cm tall » ; « a classic museum gallery attendant’s chair, dark stained oak frame, upholstered seat in deep burgundy fabric » ; image Nano Banana puis image → 3D : « a museum bookshop display table, walnut wood with turned legs and a lower shelf, stacks of colourful art books and exhibition catalogues » ; « a red fire extinguisher, 6 kg, black handle and hose, pressure gauge » ; « a freestanding museum information sign, blank dark green enamel panel between two black cast iron posts » ; « a classic European city bicycle, dark green frame, mudguards, rear rack » (cadre repeint en noir par le script) ; images Nano Banana puis image → 3D : « a classic red steel road bike, slim horizontal top tube, drop handlebars wrapped in bar tape, thin 700c wheels » et « a Dutch ladies’ city bike, low step-through frame painted pastel light blue, wicker basket on the front, brown sprung leather saddle, full chain guard » ; « a classical French garden fountain, round low limestone basin, central pedestal holding an upper bowl » ; Modelés par le script : la caisse de Versailles et son buis (texture de feuilles calculée), l’abri à vélos, ses arceaux et les antivols | généré pour le dépôt (conditions de Meshy) | cordon de velours des vitrines, chaise du gardien, table de livres, extincteurs, abri à vélos et ses trois vélos, panneau des horaires, fontaine, caisses de Versailles |
| herisson | Meshy (généré par IA) : image Nano Banana Pro puis image → 3D, d’après une photo et une vidéo de Philippe ; prompt : « Studio photograph of a single young European hedgehog (Erinaceus europaeus), baby about 15 cm long, walking, seen from a three-quarter side view… dense spines on the back and flanks: each spine dark brown-black with a distinct cream-white tip… grey-brown soft furry face and belly, a fringe of fur skirt hiding the short legs… long pointed dark snout with a wet black nose, small shiny black eyes » ; mis à l’échelle, pattes tassées et allégé (visage intact) par `tools/blender/build-herisson.py` | généré pour le dépôt (conditions de Meshy) | le bébé hérisson du jardin japonais |
