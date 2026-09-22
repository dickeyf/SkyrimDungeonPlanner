"""
Generate tiny synthetic test fixtures for the TypeScript parsers (no game files in the
repo): a NIF with two shapes (full- and half-precision positions, a child node transform,
an alpha-property decal), LZ4 frames, and a BSA v105 archive containing the NIF compressed
plus a stored text file. Output: src/lib/testdata/fixtures.ts (base64 + expected values).

    python tools/make_fixtures.py
"""

from __future__ import annotations

import base64
import json
import struct
from pathlib import Path

import lz4.frame
import numpy as np

from bsa import BsaArchive
from nif import NifFile

OUT = Path(__file__).resolve().parents[1] / "src" / "lib" / "testdata" / "fixtures.ts"


# -- NIF ------------------------------------------------------------------------------------


def sized(s: str) -> bytes:
    b = s.encode("cp1252")
    return struct.pack("<I", len(b)) + b


def export_string(s: str) -> bytes:
    b = s.encode("cp1252") + b"\x00"
    return struct.pack("<B", len(b)) + b


def av_object(name_idx: int, translation=(0, 0, 0), collision=-1) -> bytes:
    rot = (1, 0, 0, 0, 1, 0, 0, 0, 1)  # identity, column-major = row-major here
    return (
        struct.pack("<i", name_idx)
        + struct.pack("<I", 0)  # extra data
        + struct.pack("<i", -1)  # controller
        + struct.pack("<I", 14)  # flags
        + struct.pack("<3f", *translation)
        + struct.pack("<9f", *rot)
        + struct.pack("<f", 1.0)
        + struct.pack("<i", collision)
    )


def node_block(name_idx: int, children: list[int], translation=(0, 0, 0)) -> bytes:
    return av_object(name_idx, translation) + struct.pack("<I", len(children)) + struct.pack(f"<{len(children)}i", *children) + struct.pack("<I", 0)


def trishape_block(name_idx: int, verts, tris, full: bool, shader=-1, alpha=-1) -> bytes:
    if full:
        # positions: 3 floats + bitangent X float (16), UVs: 2 halfs (4) -> 20 bytes
        desc = (0x3 << 44) | (4 << 8) | 5
        vdata = b"".join(struct.pack("<4f", x, y, z, 0.0) + struct.pack("<2e", 0.0, 0.0) for x, y, z in verts)
    else:
        # positions: 4 halfs (8) -> 8 bytes, VERTEX flag only
        desc = (0x1 << 44) | 2
        vdata = b"".join(struct.pack("<4e", x, y, z, 0.0) for x, y, z in verts)
    tdata = b"".join(struct.pack("<3H", *t) for t in tris)
    body = (
        av_object(name_idx)
        + struct.pack("<3f", 0, 0, 0)
        + struct.pack("<f", 300.0)
        + struct.pack("<i", -1)  # skin
        + struct.pack("<i", shader)
        + struct.pack("<i", alpha)
        + struct.pack("<Q", desc)
        + struct.pack("<H", len(tris))
        + struct.pack("<H", len(verts))
        + struct.pack("<I", len(vdata) + len(tdata))
        + vdata
        + tdata
        + struct.pack("<I", 0)  # particle data size
    )
    return body


def make_nif() -> tuple[bytes, dict]:
    strings = ["Tile", "Floor", "Offset", "Decal"]
    floor_verts = [(-128, -128, 8), (128, -128, 8), (128, 128, 8), (-128, 128, 8)]
    floor_tris = [(0, 1, 2), (0, 2, 3)]
    decal_verts = [(0, 0, 0), (10, 0, 0), (0, 10, 0)]
    decal_tris = [(0, 1, 2)]
    blocks = [
        ("BSFadeNode", node_block(0, [1, 2])),
        ("BSTriShape", trishape_block(1, floor_verts, floor_tris, full=True, shader=5)),
        ("NiNode", node_block(2, [3], translation=(0, 0, 100))),
        ("BSTriShape", trishape_block(3, decal_verts, decal_tris, full=False, shader=5, alpha=4)),
        ("NiAlphaProperty", b"\xff" * 11),  # opaque to our reader; skipped by size
        ("BSLightingShaderProperty", b"\x00" * 40),
    ]
    types = sorted({t for t, _ in blocks})
    header = b"Gamebryo File Format, Version 20.2.0.7\n"
    header += struct.pack("<IBII", 0x14020007, 1, 12, len(blocks)) + struct.pack("<I", 100)
    header += export_string("fixture") + export_string("") + export_string("make_fixtures.py")
    header += struct.pack("<H", len(types)) + b"".join(sized(t) for t in types)
    header += struct.pack(f"<{len(blocks)}H", *(types.index(t) for t, _ in blocks))
    header += struct.pack(f"<{len(blocks)}I", *(len(b) for _, b in blocks))
    header += struct.pack("<II", len(strings), max(len(s) for s in strings)) + b"".join(sized(s) for s in strings)
    header += struct.pack("<I", 0)  # groups
    footer = struct.pack("<Ii", 1, 0)
    data = header + b"".join(b for _, b in blocks) + footer

    parsed = NifFile(data)  # sanity check with the Python reference reader
    shapes = parsed.shapes()
    assert [s.block.name for s in shapes] == ["Floor", "Decal"], shapes
    world = np.vstack([s.world_vertices for s in shapes])
    expected = {
        "blockTypes": types,
        "blockNames": [b.name for b in parsed.blocks],
        "floorVertices": floor_verts,
        "decalWorldVertices": [[0, 0, 100], [10, 0, 100], [0, 10, 100]],
        "bboxMin": world.min(0).tolist(),
        "bboxMax": world.max(0).tolist(),
        "triangleCount": len(floor_tris) + len(decal_tris),
    }
    return data, expected


# -- BSA ------------------------------------------------------------------------------------


def make_bsa(files: dict[str, tuple[bytes, bool]]) -> bytes:
    """files: archive path -> (content, compressed). Flags 0x87 like the vanilla archives."""
    folders: dict[str, list[tuple[str, bytes, bool]]] = {}
    for path, (content, compressed) in files.items():
        folder, _, name = path.replace("/", "\\").rpartition("\\")
        folders.setdefault(folder, []).append((name, content, compressed))
    folder_names = sorted(folders)
    flags = 0x1 | 0x2 | 0x4 | 0x80
    file_count = sum(len(v) for v in folders.values())
    total_folder_name_len = sum(len(f) + 1 for f in folder_names)
    all_file_names = [n for f in folder_names for n, _, _ in folders[f]]
    total_file_name_len = sum(len(n) + 1 for n in all_file_names)

    header_size = 36
    folder_records_size = 24 * len(folder_names)
    file_record_blocks_size = sum(1 + len(f) + 1 + 16 * len(folders[f]) for f in folder_names)
    data_start = header_size + folder_records_size + file_record_blocks_size + total_file_name_len

    payloads = []
    offset = data_start
    entries = {}
    for f in folder_names:
        for name, content, compressed in folders[f]:
            if compressed:
                blob = struct.pack("<I", len(content)) + lz4.frame.compress(content, store_size=False)
                size = len(blob)
            else:
                blob = content
                size = len(blob) | 0x40000000  # toggle: not compressed in a compressed-by-default archive
            entries[(f, name)] = (offset, size)
            payloads.append(blob)
            offset += len(blob)

    out = bytearray()
    out += struct.pack("<4sIIIIIIIHH", b"BSA\x00", 105, 36, flags, len(folder_names), file_count, total_folder_name_len, total_file_name_len, 0x1, 0)
    block_pos = header_size + folder_records_size
    for f in folder_names:
        out += struct.pack("<QIIQ", 0, len(folders[f]), 0, block_pos + total_file_name_len)
        block_pos += 1 + len(f) + 1 + 16 * len(folders[f])
    for f in folder_names:
        fb = f.encode("cp1252") + b"\x00"
        out += struct.pack("<B", len(fb)) + fb
        for name, _, _ in folders[f]:
            off, size = entries[(f, name)]
            out += struct.pack("<QII", 0, size, off)
    for n in all_file_names:
        out += n.encode("cp1252") + b"\x00"
    assert len(out) == data_start
    for p in payloads:
        out += p
    return bytes(out)


def main() -> None:
    nif_bytes, nif_expected = make_nif()
    readme = b"loose text file stored uncompressed\n"
    bsa_bytes = make_bsa(
        {
            "meshes/dungeons/imperial/smallhall/tiny.nif": (nif_bytes, True),
            "meshes/readme.txt": (readme, False),
        }
    )
    # sanity check with the Python reference reader
    tmp = OUT.parent / "tiny.bsa.tmp"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(bsa_bytes)
    try:
        with BsaArchive(tmp) as arc:
            assert arc.read("meshes/dungeons/imperial/smallhall/tiny.nif") == nif_bytes
            assert arc.read("meshes/readme.txt") == readme
    finally:
        tmp.unlink()

    plain = b"Skyrim Dungeon Planner " * 40 + bytes(range(256)) + b"end"
    frame = lz4.frame.compress(plain, store_size=True)
    frame_checksums = lz4.frame.compress(plain, store_size=False, content_checksum=True, block_checksum=True, block_size=lz4.frame.BLOCKSIZE_MAX64KB)

    b64 = lambda b: base64.b64encode(b).decode("ascii")
    ts = "// Generated by tools/make_fixtures.py - do not edit.\n"
    ts += "// Tiny synthetic NIF / BSA / LZ4 fixtures (no game data).\n\n"
    ts += f"export const TINY_NIF_B64 = {json.dumps(b64(nif_bytes))};\n"
    ts += f"export const TINY_NIF_EXPECTED = {json.dumps(nif_expected)} as const;\n\n"
    ts += f"export const TINY_BSA_B64 = {json.dumps(b64(bsa_bytes))};\n"
    ts += f"export const TINY_BSA_README = {json.dumps(readme.decode())};\n\n"
    ts += f"export const LZ4_PLAIN_B64 = {json.dumps(b64(plain))};\n"
    ts += f"export const LZ4_FRAME_B64 = {json.dumps(b64(frame))};\n"
    ts += f"export const LZ4_FRAME_CHECKSUMS_B64 = {json.dumps(b64(frame_checksums))};\n\n"
    ts += "export function fromBase64(b64: string): Uint8Array {\n"
    ts += "  const bin = atob(b64);\n  const out = new Uint8Array(bin.length);\n"
    ts += "  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);\n  return out;\n}\n"
    OUT.write_text(ts, encoding="utf-8", newline="\n")
    print(f"wrote {OUT} (nif {len(nif_bytes)} B, bsa {len(bsa_bytes)} B, lz4 frame {len(frame)} B)")


if __name__ == "__main__":
    main()
