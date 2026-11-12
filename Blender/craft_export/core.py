"""Parts of the Craft Export add-on that do not need Blender: particle settings in the apps' format, axis
conversion, and writing PNG, sprite sheet and animated GIF files (pure Python, so they also run in the tests)."""
import struct
import zlib

FORMAT = "craft.blendfx"
VERSION = 1


# ----------------------------------------------------------------------------------------------- axes and settings
def z_up_to_y_up(x, y, z):
    """Blender (Z up, -Y forward) -> the apps (Y up): (x, y, z) -> (x, z, -y)."""
    return x, z, -y


def hex_color(r, g, b):
    """Linear 0..1 colour -> sRGB hex (as the apps store colours)."""
    def c(v):
        v = max(0.0, min(1.0, v))
        s = v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        return round(s * 255)
    return "#%02x%02x%02x" % (c(r), c(g), c(b))


RENDER_AS = {"HALO": "HALO", "LINE": "LINE", "PATH": "PATH", "OBJECT": "OBJECT", "COLLECTION": "COLLECTION", "NONE": "NONE"}


def particle_settings(name, s, scene_gravity_z, fps, color):
    """One particle system in the shared format (Shared/src/vfx/blender.ts, BlenderParticles).

    `s` is a ParticleSettings-like object (bpy.types.ParticleSettings or anything with the same attributes)."""
    weights = getattr(s, "effector_weights", None)
    gw = getattr(weights, "gravity", 1.0) if weights is not None else 1.0
    ov = tuple(getattr(s, "object_align_factor", (0.0, 0.0, 0.0)))
    return {
        "name": name,
        "type": "HAIR" if getattr(s, "type", "EMITTER") == "HAIR" else "EMITTER",
        "count": int(getattr(s, "count", 0)),
        "frameStart": float(getattr(s, "frame_start", 1)),
        "frameEnd": float(getattr(s, "frame_end", 200)),
        "lifetime": float(getattr(s, "lifetime", 50)),
        "lifetimeRandom": float(getattr(s, "lifetime_random", 0)),
        "emitFrom": {"VERT": "VERT", "FACE": "FACE", "VOLUME": "VOLUME"}.get(getattr(s, "emit_from", "FACE"), "FACE"),
        "normalVelocity": float(getattr(s, "normal_factor", 1)),
        "randomVelocity": float(getattr(s, "factor_random", 0)),
        "tangentVelocity": float(getattr(s, "tangent_factor", 0)),
        "objectVelocity": [float(v) for v in ov[:3]],
        "physics": getattr(s, "physics_type", "NEWTON") if getattr(s, "physics_type", "NEWTON") in ("NO", "NEWTON", "KEYED", "BOIDS", "FLUID") else "NEWTON",
        "gravity": float(scene_gravity_z) * float(gw),
        "damping": float(getattr(s, "damping", 0)),
        "drag": float(getattr(s, "drag_factor", 0)),
        "brownian": float(getattr(s, "brownian_factor", 0)),
        "size": float(getattr(s, "particle_size", 0.05)),
        "sizeRandom": float(getattr(s, "size_random", 0)),
        "angularVelocity": float(getattr(s, "angular_velocity_factor", 0)),
        "renderAs": RENDER_AS.get(getattr(s, "render_type", "HALO"), "HALO"),
        "color": color,
        "fps": float(fps),
    }


def craftfx(source, fps, objects):
    """The .craftfx.json document ParticleCraft (and GameCraft / LogicCraft) import."""
    return {"format": FORMAT, "version": VERSION, "source": source, "fps": fps, "objects": objects}


# ----------------------------------------------------------------------------------------------- PNG
def _chunk(kind, data):
    c = struct.pack(">I", len(data)) + kind + data
    return c + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(width, height, rgba):
    """RGBA bytes (row by row, top first) -> PNG file bytes."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + _chunk(b"IEND", b"")


def pack_sheet(frames, width, height, cols, padding=0):
    """Frames (RGBA bytes each) into a grid, reading order. Returns (sheet_width, sheet_height, rgba)."""
    n = len(frames)
    cols = max(1, min(cols, n))
    rows = (n + cols - 1) // cols
    sw, sh = cols * width + (cols - 1) * padding, rows * height + (rows - 1) * padding
    out = bytearray(sw * sh * 4)
    for k, f in enumerate(frames):
        ox, oy = (k % cols) * (width + padding), (k // cols) * (height + padding)
        for y in range(height):
            src = y * width * 4
            dst = ((oy + y) * sw + ox) * 4
            out[dst:dst + width * 4] = f[src:src + width * 4]
    return sw, sh, out


# ----------------------------------------------------------------------------------------------- GIF
def quantize(rgba, colors=256, transparent=True, threshold=128, background=(0, 0, 0)):
    """Most-used colours (5 bits per channel buckets, averaged) and each pixel's palette index."""
    n = len(rgba) // 4
    maxc = max(2, min(256, colors)) - (1 if transparent else 0)
    count, sums, keys = {}, {}, [0] * n
    br, bg, bb = background
    for i in range(n):
        r, g, b, a = rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]
        if transparent:
            if a < threshold:
                keys[i] = -1
                continue
        else:
            f = a / 255.0
            r, g, b = int(r * f + br * (1 - f)), int(g * f + bg * (1 - f)), int(b * f + bb * (1 - f))
        k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
        keys[i] = k
        count[k] = count.get(k, 0) + 1
        s = sums.setdefault(k, [0, 0, 0])
        s[0] += r; s[1] += g; s[2] += b
    top = sorted(count, key=lambda k: -count[k])[:maxc]
    pal = []
    for k in top:
        c = count[k]
        pal += [round(sums[k][0] / c), round(sums[k][1] / c), round(sums[k][2] / c)]
    if not pal:
        pal = [0, 0, 0]
    t_index = len(pal) // 3 if transparent else -1
    if transparent:
        pal += [0, 0, 0]
    cache = {}

    def nearest(k):
        r, g, b = ((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4
        best, bd = 0, None
        for j in range(len(top)):
            d = (pal[j * 3] - r) ** 2 * 2 + (pal[j * 3 + 1] - g) ** 2 * 3 + (pal[j * 3 + 2] - b) ** 2
            if bd is None or d < bd:
                bd, best = d, j
        return best

    index = bytearray(n)
    for i, k in enumerate(keys):
        if k < 0:
            index[i] = t_index
            continue
        m = cache.get(k)
        if m is None:
            m = cache[k] = nearest(k)
        index[i] = m
    return pal, index, t_index


def lzw(index, min_code):
    """GIF LZW (variable code size, clear when the table is full), packed in sub-blocks."""
    out = bytearray()
    clear, eoi = 1 << min_code, (1 << min_code) + 1
    size, nxt = min_code + 1, eoi + 1
    table = {}
    cur = bits = 0
    block = bytearray()

    def emit(code):
        nonlocal cur, bits
        cur |= code << bits
        bits += size
        while bits >= 8:
            block.append(cur & 255)
            cur >>= 8
            bits -= 8
            if len(block) == 255:
                out.append(255); out.extend(block); block.clear()

    emit(clear)
    prefix = index[0] if index else 0
    for c in index[1:]:
        key = (prefix << 8) | c
        hit = table.get(key)
        if hit is not None:
            prefix = hit
            continue
        emit(prefix)
        if nxt < 4096:
            table[key] = nxt
            nxt += 1
            if nxt > (1 << size) and size < 12:
                size += 1
        else:
            emit(clear)
            table = {}
            size, nxt = min_code + 1, eoi + 1
        prefix = c
    if index:
        emit(prefix)
    emit(eoi)
    if bits > 0:
        block.append(cur & 255)
    if block:
        out.append(len(block)); out.extend(block)
    out.append(0)
    return bytes(out)


def gif_bytes(frames, width, height, fps, loop=True, transparent=True, background=(0, 0, 0), colors=256):
    """Animated GIF89a from RGBA frames (bytes each, top row first)."""
    o = bytearray(b"GIF89a")
    o += struct.pack("<HH", width, height) + bytes([0x70, 0, 0])
    if loop:
        o += b"\x21\xff\x0bNETSCAPE2.0\x03\x01" + struct.pack("<H", 0) + b"\x00"
    delay = max(2, round(100 / max(1, fps)))
    for f in frames:
        pal, index, t = quantize(f, colors, transparent, 128, background)
        o += b"\x21\xf9\x04" + bytes([((2 << 2) | 1) if transparent else (1 << 2)]) + struct.pack("<H", delay) + bytes([t if transparent else 0, 0])
        k = 0
        while (2 << k) < len(pal) // 3:
            k += 1
        o += b"\x2c" + struct.pack("<HHHH", 0, 0, width, height) + bytes([0x80 | k])
        for i in range(2 << k):
            o += bytes(pal[i * 3:i * 3 + 3] if i * 3 + 2 < len(pal) else [0, 0, 0])
        mc = max(2, k + 1)
        o.append(mc)
        o += lzw(index, mc)
    o.append(0x3B)
    return bytes(o)
