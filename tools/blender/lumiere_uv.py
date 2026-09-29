"""
Les UV de lumière d'un modèle du bâtiment : une seconde couche, « Lumiere »,
dépliée sur l'ensemble de ses objets à la fois dans le carré [0, 1]², à densité
constante et sans recouvrement. `tools/blender/bake-lumiere.py` la range dans
l'atlas de lumière et y cuit l'éclairement ; `src/scene/lumiere.ts` la relit.

C'est toujours la DERNIÈRE couche UV du maillage : l'export glTF en fait
TEXCOORD_1 derrière les UV de matière, TEXCOORD_0 quand il n'y en a pas.

Déterministe : la projection « smart » de Blender ne tire rien au hasard.
"""

import math

import bpy

MARGE = 0.003  # entre deux îlots, en fraction du carré : 3 texels d'une région de 1024, que la marge de cuisson (2) ne franchit pas


def deplier(objets, sol=None):
    """`sol` : un plancher plat fait de pièces détachées (un parquet lame par
    lame). Déplié îlot par îlot, chaque lame paierait sa marge : il est projeté
    d'en haut d'un seul tenant sur tout le carré, et reçoit sa propre région
    d'atlas (`MODELES` de `tools/bake-lumiere.ts`, aux proportions du sol)."""
    for o in objets + ([sol] if sol else []):
        rendu = o.data.uv_layers.active_render
        couche = o.data.uv_layers.new(name="Lumiere")
        o.data.uv_layers.active = couche
        if rendu is not None:  # les UV de matière restent celles du rendu
            rendu.active_render = True
    if sol is not None:
        me = sol.data
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        x0, y0, dx, dy = min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)
        for boucle, uv in zip(me.loops, me.uv_layers["Lumiere"].uv):
            co = me.vertices[boucle.vertex_index].co
            uv.vector = ((co.x - x0) / dx, (co.y - y0) / dy)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objets[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, scale=True, margin_method="FRACTION", margin=MARGE, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
