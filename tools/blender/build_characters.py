"""
Builds the hunter and the animals in Blender and exports them as skinned glTF.

Run headless:
    blender -b --factory-startup --python tools/blender/build_characters.py -- public/models [--preview DIR]

Each body is grown from a "skin skeleton": points with radii joined by edges.
Blender's Skin modifier wraps them in one continuous mesh, and subdivision
rounds it off. Bones sit exactly where the game's joints are, so the game's
own animation code drives them. Colours are painted per vertex.

Coordinates here are the game's: +X right, +Y up, -Z forward. They are turned
into Blender's Z-up space on the way in; the glTF exporter turns them back.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "public/models"
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None


def bl(p):
    """Game coordinates to Blender's."""
    return Vector((p[0], -p[2], p[1]))


def game(v):
    """Blender coordinates to the game's."""
    return (v.x, v.z, -v.y)


def hexrgb(h):
    return (((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def sides(prefix, fn):
    """Left (-X) and right (+X) versions of a pair of limbs."""
    out = {}
    for s, tag in ((-1, "L"), (1, "R")):
        out.update(fn(s, tag))
    return out


# ---------------------------------------------------------------- the hunter

def hunter():
    joints = [
        # name, parent, position, weighting segments, limb radius
        ("hips", None, (0, 0.95, 0), [((0, 0.84, 0), (0, 1.0, 0))], 0.165),
        ("torso", "hips", (0, 0.95, 0), [((0, 1.0, 0), (0, 1.5, 0))], 0.175),
        ("head", "torso", (0, 1.59, 0), [((0, 1.58, 0), (0, 1.84, 0))], 0.1),
    ]
    for s, t in ((-1, "L"), (1, "R")):
        joints += [
            ("leg" + t, "hips", (s * 0.095, 0.93, 0), [((s * 0.095, 0.93, 0), (s * 0.095, 0.48, 0))], 0.09),
            ("knee" + t, "leg" + t, (s * 0.095, 0.48, 0),
             [((s * 0.095, 0.48, 0), (s * 0.095, 0.08, 0)), ((s * 0.095, 0.06, 0), (s * 0.095, 0.03, -0.15))], 0.064),
            ("shoulder" + t, "torso", (s * 0.235, 1.47, 0), [((s * 0.235, 1.47, 0), (s * 0.235, 1.19, 0))], 0.06),
            ("elbow" + t, "shoulder" + t, (s * 0.235, 1.19, 0), [((s * 0.235, 1.19, 0), (s * 0.235, 0.8, -0.01))], 0.047),
        ]

    nodes = {
        "pelvis": (0, 0.93, 0, 0.165, 0.125),
        "waist": (0, 1.07, 0, 0.15, 0.115),
        "chest": (0, 1.28, -0.005, 0.175, 0.13),
        "shoulders": (0, 1.44, 0.01, 0.18, 0.115),
        "neck0": (0, 1.53, 0.01, 0.068, 0.068),
        "neck1": (0, 1.6, 0.0, 0.058, 0.06),
        "jaw": (0, 1.665, -0.012, 0.07, 0.078),
        "head": (0, 1.73, 0.0, 0.092, 0.105),
        "crown": (0, 1.81, 0.006, 0.066, 0.074),
    }
    edges = [("pelvis", "waist"), ("waist", "chest"), ("chest", "shoulders"), ("shoulders", "neck0"),
             ("neck0", "neck1"), ("neck1", "jaw"), ("jaw", "head"), ("head", "crown")]
    for s, t in ((-1, "L"), (1, "R")):
        nodes.update({
            "delt" + t: (s * 0.2, 1.45, 0.0, 0.07, 0.07),
            "shoulder" + t: (s * 0.235, 1.4, 0.0, 0.064, 0.064),
            "elbow" + t: (s * 0.235, 1.19, 0, 0.052, 0.052),
            "wrist" + t: (s * 0.235, 0.95, 0, 0.04, 0.036),
            "hand" + t: (s * 0.235, 0.87, -0.01, 0.042, 0.028),
            "finger" + t: (s * 0.235, 0.8, -0.012, 0.03, 0.02),
            "hip" + t: (s * 0.095, 0.9, 0, 0.098, 0.1),
            "knee" + t: (s * 0.095, 0.48, 0, 0.066, 0.068),
            "calf" + t: (s * 0.095, 0.3, 0.012, 0.066, 0.072),
            "ankle" + t: (s * 0.095, 0.09, 0.0, 0.054, 0.056),
            "toe" + t: (s * 0.095, 0.035, -0.16, 0.05, 0.034),
        })
        edges += [("shoulders", "delt" + t), ("delt" + t, "shoulder" + t), ("shoulder" + t, "elbow" + t), ("elbow" + t, "wrist" + t),
                  ("wrist" + t, "hand" + t), ("hand" + t, "finger" + t),
                  ("pelvis", "hip" + t), ("hip" + t, "knee" + t), ("knee" + t, "calf" + t),
                  ("calf" + t, "ankle" + t), ("ankle" + t, "toe" + t)]

    skin = hexrgb(0xB4806A)
    hair = hexrgb(0x17120E)
    beard = hexrgb(0x2A1D14)
    jerkin = hexrgb(0x1F1915)
    tunic = hexrgb(0x30352C)
    leather = hexrgb(0x4A3120)
    bracer = hexrgb(0x3A2616)
    trousers = hexrgb(0x2C2620)
    boots = hexrgb(0x1C1612)

    def colour(x, y, z):
        arm = abs(x) > 0.185 and 0.78 < y < 1.5
        if y > 1.54 and not arm:
            if y > 1.775 or (z > 0.02 and y > 1.64):
                return hair
            if z < -0.04 and y < 1.7 and y > 1.6:
                return beard
            return skin
        if arm:
            if y < 0.935:
                return leather
            if x < 0 and y < 1.1:
                return bracer
            return tunic
        if y > 1.09:
            return jerkin
        if y > 1.0:
            return leather
        if y > 0.8 and abs(x) < 0.2:
            return tunic
        if y < 0.36:
            return boots
        return trousers

    return dict(joints=joints, nodes=nodes, edges=edges, colour=colour, subdiv=2, roughness=0.85)


# ---------------------------------------------------------------- red deer

def deer(stag):
    base = hexrgb(0x4E2C17 if stag else 0x5A3521)
    belly = mix(base, hexrgb(0xCDB89A), 0.6)
    rump = hexrgb(0xD9C7A5)
    dark = tuple(c * 0.55 for c in base)
    hoof = hexrgb(0x1C1714)
    k = 1.25 if stag else 0.95

    joints = [
        ("body", None, (0, 1.02, 0), [((0, 1.06, 0.72), (0, 1.03, -0.5))], 0.24),
        ("neck", "body", (0, 1.14, -0.6), [((0, 1.16, -0.62), (0, 1.6, -0.84))], 0.11),
        ("head", "neck", (0, 1.64, -0.86), [((0, 1.65, -0.88), (0, 1.6, -1.14))], 0.07),
        ("tail", "body", (0, 1.18, 0.78), [((0, 1.14, 0.8), (0, 1.04, 0.84))], 0.04),
    ]
    legs = [(-0.11, -0.5, True), (0.11, -0.5, True), (-0.12, 0.52, False), (0.12, 0.52, False)]
    nodes = {
        "tailroot": (0, 1.13, 0.78, 0.045, 0.04),
        "tailtip": (0, 1.04, 0.83, 0.035, 0.03),
        "rump": (0, 1.08, 0.6, 0.17, 0.21),
        "mid": (0, 1.03, 0.1, 0.19, 0.25),
        "chest": (0, 1.0, -0.36, 0.19, 0.28),
        "withers": (0, 1.12, -0.56, 0.15, 0.22),
        "neck0": (0, 1.24, -0.67, 0.12 * k, 0.15 * k),
        "neck1": (0, 1.41, -0.76, 0.095 * k, 0.11 * k),
        "neck2": (0, 1.56, -0.83, 0.075, 0.085),
        "skull": (0, 1.655, -0.9, 0.07, 0.082),
        "muzzle": (0, 1.61, -1.04, 0.045, 0.052),
        "nose": (0, 1.595, -1.12, 0.032, 0.034),
    }
    edges = [("tailroot", "tailtip"), ("rump", "tailroot"), ("rump", "mid"), ("mid", "chest"), ("chest", "withers"),
             ("withers", "neck0"), ("neck0", "neck1"), ("neck1", "neck2"), ("neck2", "skull"), ("skull", "muzzle"),
             ("muzzle", "nose")]
    for i, (x, z, front) in enumerate(legs):
        hip = (x, 0.97, z)
        if front:
            knee = (x, 0.55, z + 0.02)
            joints.append(("leg%d" % i, "body", hip, [(hip, knee)], 0.07))
            joints.append(("lower%d" % i, "leg%d" % i, knee, [(knee, (x, 0.0, z))], 0.03))
            nodes.update({
                "top%d" % i: (x, 0.93, z + 0.01, 0.075, 0.08),
                "knee%d" % i: (x, 0.55, z + 0.02, 0.034, 0.036),
                "fet%d" % i: (x, 0.1, z, 0.022, 0.024),
                "hoof%d" % i: (x, 0.02, z - 0.01, 0.028, 0.034),
            })
            edges += [("chest", "top%d" % i), ("top%d" % i, "knee%d" % i), ("knee%d" % i, "fet%d" % i), ("fet%d" % i, "hoof%d" % i)]
        else:
            hock = (x, 0.53, z + 0.14)
            joints.append(("leg%d" % i, "body", hip, [(hip, hock)], 0.1))
            joints.append(("lower%d" % i, "leg%d" % i, hock, [(hock, (x, 0.0, z))], 0.03))
            nodes.update({
                "top%d" % i: (x, 0.95, z + 0.04, 0.1, 0.13),
                "thigh%d" % i: (x, 0.76, z + 0.1, 0.075, 0.1),
                "knee%d" % i: (x, 0.53, z + 0.14, 0.036, 0.042),
                "fet%d" % i: (x, 0.1, z + 0.02, 0.023, 0.025),
                "hoof%d" % i: (x, 0.02, z + 0.01, 0.028, 0.034),
            })
            edges += [("rump", "top%d" % i), ("top%d" % i, "thigh%d" % i), ("thigh%d" % i, "knee%d" % i),
                      ("knee%d" % i, "fet%d" % i), ("fet%d" % i, "hoof%d" % i)]

    def colour(x, y, z):
        if y < 0.06:
            return hoof
        if z < -1.1 and y > 1.5:
            return hexrgb(0x151110)
        torso = -0.65 < z < 0.8 and y > 0.7
        c = base
        if torso and 0.78 < y < 0.92 and abs(x) < 0.09 and -0.45 < z < 0.45:
            c = mix(base, belly, (0.92 - y) * 8)
        if z > 0.62 and y > 0.98 and abs(x) < 0.11:
            c = mix(c, rump, (z - 0.62) * 8)
        if torso and y > 1.18 and z > -0.55:
            c = mix(c, dark, 0.3)
        if stag and -0.88 < z < -0.55 and y > 1.15 and y < 1.56:
            c = mix(c, dark, 0.55)
        if y < 0.5 and not torso:
            c = tuple(v * 0.8 for v in c)
        return c

    return dict(joints=joints, nodes=nodes, edges=edges, colour=colour, subdiv=2, root="mid", roughness=0.9)


# ---------------------------------------------------------------- wild boar

def boar():
    base = hexrgb(0x3C2A1D)
    grizzle = hexrgb(0x5E4E3E)
    joints = [
        ("body", None, (0, 0.56, 0), [((0, 0.6, 0.6), (0, 0.6, -0.45))], 0.26),
        ("neck", "body", (0, 0.6, -0.6), [((0, 0.6, -0.55), (0, 0.58, -0.66))], 0.2),
        ("head", "neck", (0, 0.58, -0.65), [((0, 0.57, -0.68), (0, 0.47, -1.1))], 0.1),
        ("tail", "body", (0, 0.68, 0.66), [((0, 0.66, 0.66), (0, 0.5, 0.7))], 0.02),
    ]
    legs = [(-0.12, -0.42, True), (0.12, -0.42, True), (-0.12, 0.44, False), (0.12, 0.44, False)]
    nodes = {
        "tailroot": (0, 0.66, 0.64, 0.035, 0.035),
        "tailtip": (0, 0.5, 0.7, 0.015, 0.015),
        "rump": (0, 0.58, 0.5, 0.16, 0.2),
        "mid": (0, 0.58, 0.05, 0.2, 0.26),
        "hump": (0, 0.63, -0.33, 0.21, 0.3),
        "neck": (0, 0.6, -0.56, 0.17, 0.23),
        "head0": (0, 0.56, -0.72, 0.125, 0.155),
        "head1": (0, 0.5, -0.9, 0.08, 0.095),
        "snout": (0, 0.47, -1.07, 0.05, 0.054),
    }
    edges = [("tailroot", "tailtip"), ("rump", "tailroot"), ("rump", "mid"), ("mid", "hump"), ("hump", "neck"),
             ("neck", "head0"), ("head0", "head1"), ("head1", "snout")]
    for i, (x, z, front) in enumerate(legs):
        hip = (x, 0.48, z)
        knee = (x, 0.26, z + (0.01 if front else 0.06))
        joints.append(("leg%d" % i, "body", hip, [(hip, knee)], 0.09))
        joints.append(("lower%d" % i, "leg%d" % i, knee, [(knee, (x, 0.0, z))], 0.04))
        nodes.update({
            "top%d" % i: (x, 0.46, z + 0.02, 0.085 if front else 0.1, 0.1),
            "knee%d" % i: (knee[0], knee[1], knee[2], 0.044, 0.048),
            "hoof%d" % i: (x, 0.02, z, 0.034, 0.04),
        })
        edges += [("hump" if front else "rump", "top%d" % i), ("top%d" % i, "knee%d" % i), ("knee%d" % i, "hoof%d" % i)]

    def colour(x, y, z):
        if y < 0.05:
            return hexrgb(0x151210)
        if z < -1.05:
            return hexrgb(0x4A3A36)
        c = base
        if y > 0.72:
            c = mix(base, grizzle, (y - 0.72) * 3)
        if y < 0.4 and -0.5 < z < 0.55 and abs(x) < 0.2:
            c = tuple(v * 0.8 for v in c)
        return c

    return dict(joints=joints, nodes=nodes, edges=edges, colour=colour, subdiv=2, root="mid", roughness=0.95)


# ---------------------------------------------------------------- rabbit

def rabbit():
    base = hexrgb(0x5C4A3A)
    belly = hexrgb(0xCDBFA8)
    joints = [
        ("body", None, (0, 0.13, 0), [((0, 0.14, 0.12), (0, 0.15, -0.1))], 0.1),
        ("neck", "body", (0, 0.2, -0.13), [((0, 0.19, -0.12), (0, 0.22, -0.15))], 0.05),
        ("head", "neck", (0, 0.24, -0.16), [((0, 0.24, -0.16), (0, 0.23, -0.25))], 0.045),
        ("tail", "body", (0, 0.18, 0.17), [((0, 0.17, 0.16), (0, 0.16, 0.19))], 0.025),
    ]
    legs = [(-0.035, -0.1, True), (0.035, -0.1, True), (-0.06, 0.1, False), (0.06, 0.1, False)]
    nodes = {
        "rear": (0, 0.13, 0.11, 0.09, 0.1),
        "mid": (0, 0.15, 0.0, 0.095, 0.1),
        "chest": (0, 0.15, -0.1, 0.068, 0.075),
        "neck": (0, 0.2, -0.14, 0.05, 0.05),
        "head": (0, 0.24, -0.18, 0.044, 0.05),
        "nose": (0, 0.228, -0.235, 0.022, 0.022),
        "tail": (0, 0.16, 0.18, 0.025, 0.025),
    }
    edges = [("rear", "mid"), ("mid", "chest"), ("chest", "neck"), ("neck", "head"), ("head", "nose"), ("rear", "tail")]
    for i, (x, z, front) in enumerate(legs):
        hip = (x, 0.1, z)
        joints.append(("leg%d" % i, "body", hip, [(hip, (x, 0.02, z - 0.02))], 0.03))
        joints.append(("lower%d" % i, "leg%d" % i, hip, [((x, 0.03, z - 0.02), (x, 0.015, z - 0.06))], 0.02))
        if front:
            nodes.update({"top%d" % i: (x, 0.1, z, 0.022, 0.024), "paw%d" % i: (x, 0.015, z - 0.01, 0.016, 0.018)})
            edges += [("chest", "top%d" % i), ("top%d" % i, "paw%d" % i)]
        else:
            nodes.update({
                "top%d" % i: (x, 0.11, z, 0.06, 0.07),
                "foot%d" % i: (x, 0.02, z - 0.02, 0.02, 0.022),
                "toe%d" % i: (x, 0.015, z - 0.08, 0.017, 0.015),
            })
            edges += [("rear", "top%d" % i), ("top%d" % i, "foot%d" % i), ("foot%d" % i, "toe%d" % i)]

    def colour(x, y, z):
        if z > 0.165 and y > 0.13:
            return hexrgb(0xF2EEE6)
        if y < 0.1 and -0.12 < z < 0.14:
            return mix(base, belly, (0.1 - y) * 25)
        return base

    return dict(joints=joints, nodes=nodes, edges=edges, colour=colour, subdiv=2, root="mid", roughness=0.9)


CHARACTERS = {
    "hunter": hunter(),
    "stag": deer(True),
    "hind": deer(False),
    "boar": boar(),
    "rabbit": rabbit(),
}


# ---------------------------------------------------------------- building

def build(name, spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # The skin skeleton: points and edges, each point with its radii.
    names = list(spec["nodes"].keys())
    index = {n: i for i, n in enumerate(names)}
    bm = bmesh.new()
    skin_layer = bm.verts.layers.skin.verify()
    verts = []
    for n in names:
        x, y, z, rx, rz = spec["nodes"][n]
        v = bm.verts.new(bl((x, y, z)))
        verts.append(v)
    bm.verts.ensure_lookup_table()
    for a, b in spec["edges"]:
        bm.edges.new((verts[index[a]], verts[index[b]]))
    for i, n in enumerate(names):
        _, _, _, rx, rz = spec["nodes"][n]
        verts[i][skin_layer].radius = (rx, rz)
        verts[i][skin_layer].use_root = n == spec.get("root", names[0])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    sk = obj.modifiers.new("Skin", "SKIN")
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    sub = obj.modifiers.new("Subdivision", "SUBSURF")
    sub.levels = spec["subdiv"]
    sub.render_levels = spec["subdiv"]

    # Bake the modifiers into a plain mesh.
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.clear()
    old = obj.data
    obj.data = baked
    bpy.data.meshes.remove(old)
    me = obj.data
    me.name = name
    for p in me.polygons:
        p.use_smooth = True

    # Colours.
    col = me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="POINT")
    for i, v in enumerate(me.vertices):
        r, g, b = spec["colour"](*game(v.co))
        col.data[i].color_srgb = (r, g, b, 1.0)
    me.color_attributes.active_color = col

    mat = bpy.data.materials.new(name + "_mat")
    try:
        mat.use_nodes = True
    except AttributeError:
        pass
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = spec["roughness"]
    me.materials.append(mat)

    # The skeleton, bone for joint.
    arm = bpy.data.armatures.new(name + "_rig")
    rig = bpy.data.objects.new(name + "_rig", arm)
    scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    children = {}
    for jn, parent, pos, segs, r in spec["joints"]:
        children.setdefault(parent, []).append(jn)
    for jn, parent, pos, segs, r in spec["joints"]:
        eb = arm.edit_bones.new(jn)
        eb.head = bl(pos)
        # Point the bone along its first weighting segment, just so it has length.
        a, b = segs[0]
        d = bl(b) - bl(a)
        if d.length < 0.02:
            d = Vector((0, 0, 0.1))
        eb.tail = eb.head + d.normalized() * max(0.05, d.length)
        eb.roll = 0
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    obj.parent = rig
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

    # Weights: each vertex belongs to the bones whose limbs it is nearest,
    # measured in limb radii so a thick torso and a thin arm compete fairly,
    # and blended where two are close, so joints bend smoothly.
    groups = {jn: obj.vertex_groups.new(name=jn) for jn, *_ in spec["joints"]}
    segs = [(jn, [(bl(a), bl(b)) for a, b in s], r) for jn, _, _, s, r in spec["joints"]]
    sigma = 0.18
    for v in me.vertices:
        scores = []
        for jn, ss, r in segs:
            d = min(seg_dist(v.co, a, b) for a, b in ss)
            scores.append((d / r, jn))
        scores.sort()
        best = scores[0][0]
        picked = [(math.exp(-(s - best) / sigma), jn) for s, jn in scores[:3] if s - best < sigma * 4]
        total = sum(w for w, _ in picked)
        for w, jn in picked:
            groups[jn].add([v.index], w / total, "REPLACE")

    return obj, rig


def seg_dist(p, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared == 0 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


def export(name, path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_vertex_color="ACTIVE",
        export_image_format="NONE",
    )


def preview(name, obj, rig, directory, posed):
    """A quick side and front render, to check the shape without the game."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    scene.world = world
    if posed:
        pose_test(name, rig)
    dims = obj.dimensions
    size = max(dims) * 1.3
    centre = sum((Vector(c) for c in obj.bound_box), Vector()) / 8
    centre = obj.matrix_world @ centre
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for view, loc, rot in (
        ("side", centre + Vector((size * 3, 0, 0)), (math.pi / 2, 0, math.pi / 2)),
        ("front", centre + Vector((0, size * 3, 0)), (math.pi / 2, 0, math.pi)),
        ("three", centre + Vector((size * 2, size * 2, size * 1.2)), (math.radians(68), 0, math.radians(135))),
    ):
        cam.location = loc
        cam.rotation_euler = rot
        scene.render.filepath = os.path.join(directory, "%s_%s%s.png" % (name, view, "_posed" if posed else ""))
        bpy.ops.render.render(write_still=True)


def pose_test(name, rig):
    """Bend a few joints, to see the skin follow."""
    pb = rig.pose.bones
    for b in pb:
        b.rotation_mode = "XYZ"
    def bend(n, x=0.0, z=0.0):
        if n in pb:
            pb[n].rotation_euler = (x, 0, z)
    if name == "hunter":
        bend("legL", 0.6)
        bend("kneeL", 1.0)
        bend("legR", -0.4)
        bend("shoulderL", 1.3)
        bend("elbowR", 1.2)
        bend("torso", 0.25)
    else:
        bend("neck", 1.0)
        bend("leg0", 0.5)
        bend("lower0", 0.9)
        bend("leg2", -0.5)
        bend("lower2", -0.7)
    bpy.context.view_layer.update()


def main():
    os.makedirs(OUT, exist_ok=True)
    only = [a for a in ARGS if a in CHARACTERS]
    for name, spec in CHARACTERS.items():
        if only and name not in only:
            continue
        obj, rig = build(name, spec)
        path = os.path.join(OUT, name + ".glb")
        export(name, path)
        print("built %s: %d vertices -> %s" % (name, len(obj.data.vertices), path))
        if PREVIEW:
            os.makedirs(PREVIEW, exist_ok=True)
            preview(name, obj, rig, PREVIEW, False)
            preview(name, obj, rig, PREVIEW, True)


main()
