"""
La lumière précalculée du bâtiment : Cycles cuit l'éclairement du ciel dans un
atlas, pour que les coins s'assombrissent, que les murs près des lanterneaux
s'éclairent et que la nef reçoive la lumière douce de sa verrière.

    npm run bake       (qui écrit la scène puis appelle ce script)

ou, la scène déjà décrite par `node tools/bake-lumiere.ts --sans-blender` :

    blender --background --factory-startup --python tools/blender/bake-lumiere.py -- .lumiere/scene.json

Entrée : le JSON de `tools/bake-lumiere.ts` — les boîtes du plan (repère de
three : y en haut), leur rectangle d'atlas par face, les obstacles, les
lanterneaux, le mobilier et les modèles du bâtiment. Sortie : `atlas.png`,
l'éclairement DIFFUS (direct + rebonds, sans l'albédo du récepteur) divisé par
`PLAFOND` et encodé en sRGB — la scène le relit en `SRGBColorSpace`.

Ce que la cuisson contient : le ciel de jour (couvert, sans soleil — le soleil
reste en temps réel), les lanterneaux des galeries, les lanternes de la nef et
la lampe-soleil de la salle d'honneur. La verrière et les vitres laissent passer
le ciel ; le parc est un sol mat autour du bâtiment.

Déterministe : graine fixe, aucune horloge. Le débruitage (OIDN) l'est aussi à
matériel égal.
"""

import json
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

SCENE = Path(sys.argv[sys.argv.index("--") + 1])
D = json.loads(SCENE.read_text())
W, H = D["atlas"]["largeur"], D["atlas"]["hauteur"]

# L'éclairement encodé : 1 en PNG vaut PLAFOND. Même constante dans `src/scene/lumiere.ts`.
PLAFOND = 2.0
CIEL = (0.80, 0.86, 1.0)      # un ciel couvert, un peu bleu
LANTERNEAU = 0.9              # le verre dépoli transmet ~90 % du ciel qu'il voit
LAMPE = (24.0, 9.95, 6.0)     # SalleHonneurLayer.tsx, repère de three

# ── Une scène vide ────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def b3(x, y, z):
    """Repère de three (y en haut) → Blender (z en haut) : ce que fait l'import glTF."""
    return Vector((x, -z, y))


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


# Les albédos linéaires des matières du plan, mesurés sur les cartes et leurs gains (`materials.ts`).
ALBEDO = {
    "platre": (0.72, 0.70, 0.66),
    "pierre": (0.62, 0.55, 0.43),
    "terrazzo": (0.55, 0.52, 0.49),
    "parquet": (0.32, 0.19, 0.10),
    "granit": (0.14, 0.12, 0.10),
}


def matiere(nom, couleur, emission=0.0):
    m = bpy.data.materials.get(nom)
    if m:
        return m
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (*couleur, 1)
    p.inputs["Roughness"].default_value = 1.0
    if emission:
        p.inputs["Emission Color"].default_value = (*couleur, 1)
        p.inputs["Emission Strength"].default_value = emission
    return m


def albedo(cle):
    if cle.startswith("#"):
        return tuple(v * 0.9 for v in srgb(cle))
    return ALBEDO[cle]


# Les 6 faces d'une boîte unité, dans l'ordre de `BoxGeometry` ; chaque coin avec
# ses (s, t) — la convention de `coordonneesDeFace` (src/plan/lumiere.ts).
def coins(f):
    axe, signe = f >> 1, 0.5 if f % 2 == 0 else -0.5
    u, v = [(2, 1), (0, 2), (0, 1)][axe]
    out = []
    for a, b in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]:
        p = [0.0, 0.0, 0.0]
        p[axe], p[u], p[v] = signe, a, b
        out.append((p, (a + 0.5, b + 0.5)))
    # Sens direct vu de dehors : la normale doit sortir de la boîte.
    n = [0, 0, 0]
    n[axe] = 1 if signe > 0 else -1
    e1 = Vector(out[1][0]) - Vector(out[0][0])
    e2 = Vector(out[2][0]) - Vector(out[0][0])
    return out if e1.cross(e2).dot(Vector(n)) > 0 else out[::-1]


def maillage(nom, boites, cuites=True, seules=range(6)):
    """`boites` : (boîte, matériau, rects|None). Avec `cuites`, les seules faces qui
    ont un rectangle, leurs UV d'atlas posées ; sinon les seules qui n'en ont pas :
    elles restent pour l'ombre, dans un objet jamais cuit. Jamais deux faces
    l'une sur l'autre — la cuisson les confondrait."""
    me = bpy.data.meshes.new(nom)
    ob = bpy.data.objects.new(nom, me)
    scene.collection.objects.link(ob)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("atlas")
    mats = []
    for b, mat, rects in boites:
        if mat not in mats:
            mats.append(mat)
        centre = Vector((b["x"], b["y"], b["z"]))
        taille = (b["w"], b["h"], b["d"])
        for f in range(6):
            r = rects[f] if rects else None
            if (r is not None) != cuites or f not in seules:
                continue
            cs = coins(f)
            face = bm.faces.new([bm.verts.new(b3(*(centre + Vector(tuple(p[i] * taille[i] for i in range(3)))))) for p, _ in cs])
            face.material_index = mats.index(mat)
            if r is not None:
                for loop, (_, (s, t)) in zip(face.loops, cs):
                    loop[uv].uv = ((r[0] + s * (r[2] - r[0])) / W, (r[1] + t * (r[3] - r[1])) / H)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    return ob


# ── Les boîtes du plan ────────────────────────────────────────────────────
plan = [(s["boite"], matiere(f"Plan_{s['matiere']}", albedo(s["matiere"])), s["rects"]) for s in D["surfaces"]]
ob_recepteurs = maillage("Recepteurs", plan)
maillage("Caches", plan, cuites=False)
maillage("Obstacles", [(b, matiere("Obstacle", (0.45, 0.42, 0.38)), None) for b in D["obstacles"]], cuites=False)
maillage("Lanterneaux", [(b, matiere("Lanterneau", (1.0, 0.98, 0.94), LANTERNEAU), None) for b in D["lanterneaux"]], cuites=False, seules=[3])  # vers le bas seulement : le verre éclaire la salle, pas le plâtre derrière lui

# Le parc : un sol mat sous le bâtiment, un centimètre sous le dallage.
bpy.ops.mesh.primitive_plane_add(size=240, location=(24, -20, -0.01))
bpy.context.object.data.materials.append(matiere("Parc", (0.16, 0.18, 0.12)))

# ── Les modèles du bâtiment ───────────────────────────────────────────────
racines = {}
for chemin in D["glb"]:
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=chemin)
    if chemin.endswith("mobilier.glb"):
        for o in set(bpy.data.objects) - avant:
            if o.parent is None:
                racines[o.name] = o

# Le verre laisse passer le ciel : la verrière entièrement, les vitraux teintés à moitié.
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    p = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if p is None or m.name.startswith("Plan_"):
        continue
    if m.name == "Nef_Verre" or p.inputs["Alpha"].default_value < 0.999:
        nt = m.node_tree
        t = nt.nodes.new("ShaderNodeBsdfTransparent")
        c = p.inputs["Base Color"].default_value
        clair = 1.0 if m.name == "Nef_Verre" else 0.5
        t.inputs["Color"].default_value = tuple(clair + (1 - clair) * c[i] for i in range(3)) + (1,)
        sortie = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        nt.links.new(t.outputs[0], sortie.inputs["Surface"])

# Le mobilier : chaque pièce, posée à chaque place (`plan/mobilier.ts`).
for nom, racine in racines.items():
    col = bpy.data.collections.new(f"Piece_{nom}")
    bpy.context.scene.collection.children.link(col)
    col.instance_offset = racine.matrix_world.translation

    def lier(o):
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)
        for e in o.children:
            lier(e)

    lier(racine)
    bpy.context.view_layer.layer_collection.children[col.name].exclude = True
    for i, m in enumerate(x for x in D["mobilier"] if x["piece"] == nom):
        e = bpy.data.objects.new(f"{nom}_{i}", None)
        e.instance_type = "COLLECTION"
        e.instance_collection = col
        e.matrix_world = Matrix.Translation(b3(m["x"], m["y"], m["z"])) @ Matrix.Rotation(m["lacet"], 4, "Z")
        scene.collection.objects.link(e)

# La lampe-soleil de la salle d'honneur.
lampe = bpy.data.lights.new("Lampe", "POINT")
lampe.energy = 400
lampe.color = srgb("#ffd6a0")
lampe.shadow_soft_size = 0.4
ob = bpy.data.objects.new("Lampe", lampe)
ob.location = b3(*LAMPE)
scene.collection.objects.link(ob)

# ── Le ciel ───────────────────────────────────────────────────────────────
monde = bpy.data.worlds.new("Ciel")
monde.use_nodes = True
fond = next(n for n in monde.node_tree.nodes if n.type == "BACKGROUND")
fond.inputs["Color"].default_value = (*CIEL, 1)
fond.inputs["Strength"].default_value = 1.0
scene.world = monde

# ── Cycles ────────────────────────────────────────────────────────────────
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
for type_ in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
    try:
        prefs.compute_device_type = type_
    except TypeError:
        continue
    prefs.get_devices()
    gpus = [d for d in prefs.devices if d.type != "CPU"]
    if gpus:
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
        print(f"cuisson sur {type_} : {[d.name for d in gpus]}")
        break
scene.cycles.samples = D["echantillons"]
scene.cycles.seed = 7
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4
scene.cycles.transparent_max_bounces = 8
scene.cycles.use_denoising = False

atlas = bpy.data.images.new("Atlas", W, H, float_buffer=True, alpha=False)
for m in ob_recepteurs.data.materials:
    nt = m.node_tree
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = atlas
    nt.nodes.active = img

bpy.ops.object.select_all(action="DESELECT")
ob_recepteurs.select_set(True)
bpy.context.view_layer.objects.active = ob_recepteurs
bake = scene.render.bake
bake.margin = 2
bake.margin_type = "EXTEND"
bake.use_pass_direct = True
bake.use_pass_indirect = True
bake.use_pass_color = False
bpy.ops.object.bake(type="DIFFUSE")

# ── Débruitage (OIDN, par le compositeur) et encodage ─────────────────────
# Une scène vide à part : le compositeur ne lit que l'image, pas de rendu 3D à refaire.
compo = bpy.data.scenes.new("Debruit")
compo.render.engine = "BLENDER_WORKBENCH"
compo.render.resolution_x, compo.render.resolution_y = W, H
compo.render.resolution_percentage = 100
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
compo.collection.objects.link(cam)
compo.camera = cam
compo.view_settings.view_transform = "Standard"
compo.view_settings.look = "None"
compo.render.image_settings.file_format = "PNG"
compo.render.image_settings.color_depth = "8"
compo.render.image_settings.color_mode = "RGB"
compo.render.dither_intensity = 0.0

arbre = bpy.data.node_groups.new("Debruit", "CompositorNodeTree")
compo.compositing_node_group = arbre
arbre.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
n_img = arbre.nodes.new("CompositorNodeImage")
n_img.image = atlas
n_dn = arbre.nodes.new("CompositorNodeDenoise")
n_mul = arbre.nodes.new("ShaderNodeMix")
n_mul.data_type = "RGBA"
n_mul.blend_type = "MULTIPLY"
n_mul.inputs["Factor"].default_value = 1.0
n_mul.inputs[7].default_value = (1 / PLAFOND, 1 / PLAFOND, 1 / PLAFOND, 1)
n_out = arbre.nodes.new("NodeGroupOutput")
arbre.links.new(n_img.outputs["Image"], n_dn.inputs["Image"])
arbre.links.new(n_dn.outputs["Image"], n_mul.inputs[6])
arbre.links.new(n_mul.outputs[2], n_out.inputs[0])
compo.render.filepath = D["sortie"]
bpy.ops.render.render(write_still=True, scene=compo.name)
print(f"atlas : {D['sortie']}")
