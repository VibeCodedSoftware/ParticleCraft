"""Craft Export: send Blender objects, particle systems and rendered effects to ParticleCraft, GameCraft and
LogicCraft. 3D View > Sidebar (N) > Craft.

  ParticleCraft  the selected objects with their particle systems (.craftfx.json): each particle system becomes a
                 "Blender Particle Effect" node on an Object node; objects without particles become Object nodes to
                 emit ParticleCraft effects from.
  GameCraft      the selected objects as a .glb (meshes, materials, textures, animations) plus their particle
                 systems (.craftfx.json), which GameCraft turns into effects on the object.
  LogicCraft     the selection is rendered into frames (transparent background, your frame range, size and camera
                 angle) and saved as a PNG/JPG image sequence, optionally a sprite sheet and an animated GIF, ready
                 for LogicCraft's image import.

Files go to the shared exchange folder the apps read ("Import from ParticleCraft / Blender"), or a folder you choose.
"""
bl_info = {
    "name": "Craft Export (ParticleCraft, GameCraft, LogicCraft)",
    "author": "Craft apps",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "3D View > Sidebar > Craft",
    "description": "Export objects, particle systems and rendered effects to ParticleCraft, GameCraft and LogicCraft",
    "category": "Import-Export",
}

import json
import math
import os
import tempfile

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, IntProperty, PointerProperty, StringProperty
from mathutils import Vector

from . import core


def default_folder():
    """The apps' shared exchange folder (desktop apps), else a folder in your home."""
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return os.path.join(local, "CraftApps", "exchange")
    return os.path.join(os.path.expanduser("~"), "CraftExchange")


def safe(name):
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "export"


# ----------------------------------------------------------------------------------------------- settings
class CraftExportSettings(bpy.types.PropertyGroup):
    destination: EnumProperty(name="Send to", items=[
        ("PARTICLECRAFT", "ParticleCraft", "Objects and their particle systems, editable as nodes"),
        ("GAMECRAFT", "GameCraft", "3D model (.glb) with materials, textures, animations and particle systems"),
        ("LOGICCRAFT", "LogicCraft", "Rendered into a 2D image sequence / sprite sheet / GIF"),
    ], default="PARTICLECRAFT")
    folder: StringProperty(name="Folder", subtype="DIR_PATH", default="", description="Empty: the apps' exchange folder")
    # LogicCraft rendering
    fps: IntProperty(name="Frame rate", default=24, min=1, max=60)
    use_scene_range: BoolProperty(name="Scene frame range", default=True)
    frame_start: IntProperty(name="Start", default=1, min=0)
    frame_end: IntProperty(name="End", default=48, min=0)
    frame_step: IntProperty(name="Every", default=1, min=1, max=10, description="Render every n-th frame")
    width: IntProperty(name="Width", default=256, min=8, max=4096)
    height: IntProperty(name="Height", default=256, min=8, max=4096)
    transparent: BoolProperty(name="Transparent background", default=True)
    view: EnumProperty(name="Camera", items=[
        ("FRONT", "Front", ""), ("SIDE", "Side", ""), ("TOP", "Top", ""), ("ISO", "3/4 view", ""), ("CAMERA", "Scene camera", "The active camera as it is"),
    ], default="FRONT")
    margin: FloatProperty(name="Margin", default=1.15, min=1.0, max=3.0, description="Space around the object")
    quality: EnumProperty(name="Quality", items=[
        ("DRAFT", "Draft", "Fast (Workbench or few samples)"), ("GOOD", "Good", "EEVEE"), ("BEST", "Best", "Cycles, more samples"),
    ], default="GOOD")
    image_format: EnumProperty(name="Images", items=[("PNG", "PNG", ""), ("JPEG", "JPG", "No transparency")], default="PNG")
    sprite_sheet: BoolProperty(name="Sprite sheet", default=True)
    sheet_columns: IntProperty(name="Columns", default=0, min=0, max=64, description="0: about square")
    sheet_padding: IntProperty(name="Padding", default=0, min=0, max=32)
    gif: BoolProperty(name="Animated GIF", default=True)
    loop: BoolProperty(name="Looping animation", default=True)


# ----------------------------------------------------------------------------------------------- collecting data
def world_triangles(obj, depsgraph, max_tris=4000):
    """Evaluated mesh of an object (modifiers applied), world space, Y up, 9 numbers per triangle."""
    ev = obj.evaluated_get(depsgraph)
    try:
        me = ev.to_mesh()
    except RuntimeError:
        return []
    if me is None:
        return []
    me.calc_loop_triangles()
    mw = ev.matrix_world
    tris = list(me.loop_triangles)
    step = max(1, math.ceil(len(tris) / max_tris))
    out = []
    for t in tris[::step]:
        for vi in t.vertices:
            p = mw @ me.vertices[vi].co
            out.extend(round(c, 4) for c in core.z_up_to_y_up(p.x, p.y, p.z))
    ev.to_mesh_clear()
    return out


def material_color(obj, slot):
    mats = [s.material for s in obj.material_slots if s.material]
    if not mats:
        return "#ffffff"
    m = mats[max(0, min(len(mats) - 1, slot - 1))]
    col = m.diffuse_color
    if m.use_nodes and m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                col = n.inputs["Base Color"].default_value
                break
            if n.type == "EMISSION":
                col = n.inputs["Color"].default_value
                break
    return core.hex_color(col[0], col[1], col[2])


def object_entry(obj, depsgraph, scene):
    gz = scene.gravity[2] if scene.use_gravity else 0.0
    fps = scene.render.fps / scene.render.fps_base
    systems = []
    for ps in getattr(obj, "particle_systems", []):
        s = ps.settings
        systems.append(core.particle_settings(ps.name, s, gz, fps, material_color(obj, getattr(s, "material", 1))))
    return {"name": obj.name, "tris": world_triangles(obj, depsgraph), "color": material_color(obj, 1), "particleSystems": systems}


def write_craftfx(path, scene, objs, depsgraph):
    fps = scene.render.fps / scene.render.fps_base
    doc = core.craftfx(bpy.path.basename(bpy.data.filepath) or "untitled.blend", fps, [object_entry(o, depsgraph, scene) for o in objs])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    return doc


# ----------------------------------------------------------------------------------------------- LogicCraft rendering
def selection_bounds(objs):
    pts = []
    for o in objs:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    if not pts:
        return Vector((0, 0, 0)), 1.0
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo + hi) / 2, max((hi - lo).length, 0.01)


def framing_camera(scene, objs, st, effect_size):
    """A temporary orthographic camera looking at the selection from the chosen side."""
    centre, size = selection_bounds(objs)
    size = max(size, effect_size)
    cam_data = bpy.data.cameras.new("CraftExportCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * st.margin
    cam = bpy.data.objects.new("CraftExportCam", cam_data)
    scene.collection.objects.link(cam)
    d = size * 3
    direction = {"FRONT": Vector((0, -1, 0)), "SIDE": Vector((1, 0, 0)), "TOP": Vector((0, 0, 1)), "ISO": Vector((1, -1, 0.8)).normalized()}[st.view]
    cam.location = centre + direction * d
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Z" if st.view != "TOP" else "Y").to_euler()
    cam_data.clip_end = d * 4
    return cam


def particle_reach(objs, scene):
    """Rough size of the particle effects (lifetime × speed) so the camera does not cut them off."""
    reach = 0.0
    fps = scene.render.fps / scene.render.fps_base
    for o in objs:
        for ps in getattr(o, "particle_systems", []):
            s = ps.settings
            t = s.lifetime / fps
            v = abs(s.normal_factor) + abs(s.factor_random) + Vector(s.object_align_factor).length
            g = abs(scene.gravity[2]) * s.effector_weights.gravity if scene.use_gravity else 0
            reach = max(reach, 2 * (v * t + 0.5 * g * t * t * 0.5))
    return reach


def read_rgba(path, w, h):
    """Pixels of a rendered file as RGBA bytes, top row first."""
    img = bpy.data.images.load(path, check_existing=False)
    try:
        px = list(img.pixels[:])
        iw, ih = img.size
    finally:
        bpy.data.images.remove(img)
    out = bytearray(iw * ih * 4)
    for y in range(ih):
        src = (ih - 1 - y) * iw * 4  # Blender stores bottom row first
        for x in range(iw * 4):
            out[y * iw * 4 + x] = max(0, min(255, int(px[src + x] * 255 + 0.5)))
    return iw, ih, out


class CRAFT_OT_export(bpy.types.Operator):
    bl_idname = "craft.export"
    bl_label = "Export"
    bl_description = "Send the selected objects to the chosen app"

    def execute(self, context):
        st = context.scene.craft_export
        objs = [o for o in context.selected_objects if o.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}]
        if not objs:
            self.report({"ERROR"}, "Select one or more objects")
            return {"CANCELLED"}
        folder = bpy.path.abspath(st.folder) if st.folder else default_folder()
        os.makedirs(folder, exist_ok=True)
        base = safe(objs[0].name if len(objs) == 1 else os.path.splitext(bpy.path.basename(bpy.data.filepath) or "scene")[0])
        try:
            if st.destination == "PARTICLECRAFT":
                path = os.path.join(folder, base + ".craftfx.json")
                doc = write_craftfx(path, context.scene, objs, context.evaluated_depsgraph_get())
                n = sum(len(o["particleSystems"]) for o in doc["objects"])
                self.report({"INFO"}, f"ParticleCraft: {len(objs)} object(s), {n} particle system(s) -> {path}")
            elif st.destination == "GAMECRAFT":
                glb = os.path.join(folder, base + ".glb")
                bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_animations=True, export_apply=True, export_yup=True)
                msg = f"GameCraft: model -> {glb}"
                if any(len(getattr(o, "particle_systems", [])) for o in objs):
                    fx = os.path.join(folder, base + ".craftfx.json")
                    write_craftfx(fx, context.scene, objs, context.evaluated_depsgraph_get())
                    msg += f"; particle systems -> {fx}"
                self.report({"INFO"}, msg)
            else:
                out = render_for_logiccraft(context, objs, st, folder, base)
                self.report({"INFO"}, f"LogicCraft: {out}")
        except Exception as e:  # report instead of failing silently
            self.report({"ERROR"}, f"Export failed: {e}")
            return {"CANCELLED"}
        return {"FINISHED"}


def render_for_logiccraft(context, objs, st, folder, base):
    scene = context.scene
    r = scene.render
    saved = {
        "camera": scene.camera, "x": r.resolution_x, "y": r.resolution_y, "pct": r.resolution_percentage, "film": r.film_transparent,
        "fmt": r.image_settings.file_format, "mode": r.image_settings.color_mode, "engine": r.engine, "path": r.filepath, "frame": scene.frame_current,
        "fps": r.fps, "fps_base": r.fps_base,
    }
    hidden = [o for o in scene.objects if o.visible_get() and o not in objs and o.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}]
    for o in hidden:
        o.hide_render = True
    cam = None
    try:
        if st.view != "CAMERA" or scene.camera is None:
            cam = framing_camera(scene, objs, st, particle_reach(objs, scene))
            scene.camera = cam
        r.resolution_x, r.resolution_y, r.resolution_percentage = st.width, st.height, 100
        r.fps, r.fps_base = st.fps, 1
        r.film_transparent = st.transparent and st.image_format == "PNG"
        r.image_settings.file_format = st.image_format
        r.image_settings.color_mode = "RGBA" if st.image_format == "PNG" else "RGB"
        if st.quality == "DRAFT":
            r.engine = "BLENDER_WORKBENCH"
        elif st.quality == "GOOD":
            r.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
        else:
            r.engine = "CYCLES"
            scene.cycles.samples = 128
        start, end = (scene.frame_start, scene.frame_end) if st.use_scene_range else (st.frame_start, st.frame_end)
        out_dir = os.path.join(folder, "LogicCraft", base)
        os.makedirs(out_dir, exist_ok=True)
        ext = ".png" if st.image_format == "PNG" else ".jpg"
        paths = []
        for k, f in enumerate(range(start, end + 1, st.frame_step)):
            scene.frame_set(f)
            p = os.path.join(out_dir, f"{base}_{k + 1:04d}{ext}")
            r.filepath = p
            bpy.ops.render.render(write_still=True)
            paths.append(p)
        made = [f"{len(paths)} frames in {out_dir}"]
        if paths and (st.sprite_sheet or st.gif):
            frames = []
            w = h = 0
            for p in paths:
                w, h, px = read_rgba(p, st.width, st.height)
                frames.append(px)
            if st.sprite_sheet:
                cols = st.sheet_columns or max(1, math.ceil(math.sqrt(len(frames))))
                sw, sh, sheet = core.pack_sheet(frames, w, h, cols, st.sheet_padding)
                rows = (len(frames) + cols - 1) // cols
                sp = os.path.join(out_dir, f"{base}_sheet_{cols}x{rows}.png")
                with open(sp, "wb") as fh:
                    fh.write(core.png_bytes(sw, sh, sheet))
                made.append(f"sprite sheet {cols}x{rows}")
            if st.gif:
                gp = os.path.join(out_dir, f"{base}.gif")
                with open(gp, "wb") as fh:
                    fh.write(core.gif_bytes(frames, w, h, st.fps / st.frame_step, st.loop, st.transparent and st.image_format == "PNG"))
                made.append("GIF")
        return ", ".join(made)
    finally:
        for o in hidden:
            o.hide_render = False
        scene.camera = saved["camera"]
        r.resolution_x, r.resolution_y, r.resolution_percentage = saved["x"], saved["y"], saved["pct"]
        r.film_transparent = saved["film"]
        r.image_settings.file_format, r.image_settings.color_mode = saved["fmt"], saved["mode"]
        r.engine, r.filepath = saved["engine"], saved["path"]
        r.fps, r.fps_base = saved["fps"], saved["fps_base"]
        scene.frame_set(saved["frame"])
        if cam is not None:
            data = cam.data
            bpy.data.objects.remove(cam, do_unlink=True)
            bpy.data.cameras.remove(data)


# ----------------------------------------------------------------------------------------------- panel
class CRAFT_PT_export(bpy.types.Panel):
    bl_label = "Craft Export"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Craft"

    def draw(self, context):
        st = context.scene.craft_export
        L = self.layout
        L.prop(st, "destination", expand=True)
        sel = [o for o in context.selected_objects]
        n = sum(len(getattr(o, "particle_systems", [])) for o in sel)
        box = L.box()
        box.label(text=f"{len(sel)} selected, {n} particle system(s)")
        if st.destination == "PARTICLECRAFT":
            box.label(text="Particle systems -> Blender Particle Effect nodes")
            box.label(text="Objects without particles -> Object nodes")
        elif st.destination == "GAMECRAFT":
            box.label(text=".glb model + particle systems")
        else:
            col = L.column(align=True)
            col.prop(st, "fps"); col.prop(st, "use_scene_range")
            if not st.use_scene_range:
                row = col.row(align=True); row.prop(st, "frame_start"); row.prop(st, "frame_end")
            col.prop(st, "frame_step")
            row = col.row(align=True); row.prop(st, "width"); row.prop(st, "height")
            col.prop(st, "view"); col.prop(st, "margin"); col.prop(st, "quality")
            col.prop(st, "image_format")
            if st.image_format == "PNG":
                col.prop(st, "transparent")
            col.prop(st, "sprite_sheet")
            if st.sprite_sheet:
                row = col.row(align=True); row.prop(st, "sheet_columns"); row.prop(st, "sheet_padding")
            col.prop(st, "gif")
            col.prop(st, "loop")
        L.prop(st, "folder")
        L.label(text="Empty folder: " + default_folder())
        L.operator("craft.export", text="Send to " + {"PARTICLECRAFT": "ParticleCraft", "GAMECRAFT": "GameCraft", "LOGICCRAFT": "LogicCraft"}[st.destination], icon="EXPORT")


classes = (CraftExportSettings, CRAFT_OT_export, CRAFT_PT_export)


def register():
    for c in classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.craft_export = PointerProperty(type=CraftExportSettings)


def unregister():
    del bpy.types.Scene.craft_export
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
