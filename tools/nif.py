"""
Minimal reader for Skyrim SE NIF files (Gamebryo 20.2.0.7, user version 12, BS version 100).

Read-only and deliberately narrow: the node tree (any NiNode-derived block) with its
transforms, and BSTriShape geometry (positions and triangles). Every other block is skipped
using the per-block sizes stored in the header. This is the reference implementation for the
TypeScript port in `src/lib/format/nif` (R14b).

Format reference: nif.xml from the niftools project.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SUPPORTED_VERSION = 0x14020007  # 20.2.0.7
SUPPORTED_USER_VERSION = 12
SUPPORTED_BS_VERSION = 100

# BSVertexDesc attribute flags (bits 44+)
VF_VERTEX = 1 << 0
VF_UVS = 1 << 1
VF_UVS_2 = 1 << 2
VF_NORMALS = 1 << 3
VF_TANGENTS = 1 << 4
VF_VERTEX_COLORS = 1 << 5
VF_SKINNED = 1 << 6
VF_LAND_DATA = 1 << 7
VF_EYE_DATA = 1 << 8
VF_INSTANCE = 1 << 9
VF_FULL_PRECISION = 1 << 10


def decode_vertex_desc(desc: int) -> tuple[int, int, int]:
    """
    Decode a BSVertexDesc (u64 of 4-bit fields, offsets in 4-byte units):
    nibble 0 vertex size, 1 dynamic size, 2 uv1, 3 uv2, 4 normal, 5 tangent, 6 color,
    7 skinning, 8 landscape, 9 eye data; attribute flags start at bit 44.

    Returns (vertex size in bytes, position block size in bytes, attribute flags).
    The position block is 16 bytes (3 floats + bitangent X) or 8 bytes (4 halfs). Skyrim SE
    static meshes use 16 without setting the FULL_PRECISION flag, so the size is derived
    from the offset of the first attribute after the position rather than from the flag.
    """
    nib = [(desc >> (4 * i)) & 0xF for i in range(10)]
    flags = (desc >> 44) & 0x7FF
    vertex_size = nib[0] * 4
    following = [
        nib[2] if flags & VF_UVS else 0,
        nib[4] if flags & VF_NORMALS else 0,
        nib[5] if flags & VF_TANGENTS else 0,
        nib[6] if flags & VF_VERTEX_COLORS else 0,
        nib[7] if flags & VF_SKINNED else 0,
        nib[9] if flags & VF_EYE_DATA else 0,
    ]
    following = [o * 4 for o in following if o]
    if following:
        position_bytes = min(following)
    else:
        position_bytes = 16 if (flags & VF_FULL_PRECISION or vertex_size >= 16) else 8
    if position_bytes not in (8, 16):
        raise ValueError(f"unexpected position block size {position_bytes} in vertex desc 0x{desc:x}")
    return vertex_size, position_bytes, flags


class _Reader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def unpack(self, fmt: str):
        s = struct.Struct("<" + fmt)
        out = s.unpack_from(self.data, self.pos)
        self.pos += s.size
        return out

    def u8(self) -> int:
        return self.unpack("B")[0]

    def u16(self) -> int:
        return self.unpack("H")[0]

    def i32(self) -> int:
        return self.unpack("i")[0]

    def u32(self) -> int:
        return self.unpack("I")[0]

    def u64(self) -> int:
        return self.unpack("Q")[0]

    def f32(self) -> float:
        return self.unpack("f")[0]

    def vec3(self) -> np.ndarray:
        return np.array(self.unpack("3f"), dtype=np.float64)

    def line(self) -> str:
        end = self.data.index(b"\n", self.pos)
        s = self.data[self.pos : end].decode("cp1252")
        self.pos = end + 1
        return s

    def sized_string(self) -> str:
        n = self.u32()
        s = self.data[self.pos : self.pos + n].decode("cp1252")
        self.pos += n
        return s

    def export_string(self) -> str:
        n = self.u8()
        s = self.data[self.pos : self.pos + n].rstrip(b"\x00").decode("cp1252")
        self.pos += n
        return s

    def refs(self) -> list[int]:
        n = self.u32()
        return list(self.unpack(f"{n}i")) if n else []


@dataclass
class Transform:
    translation: np.ndarray  # (3,)
    rotation: np.ndarray  # (3, 3), applied as p' = R @ p
    scale: float

    def apply(self, points: np.ndarray) -> np.ndarray:
        return (points @ self.rotation.T) * self.scale + self.translation

    def compose(self, child: "Transform") -> "Transform":
        """Transform mapping child-local coordinates into this transform's parent space."""
        return Transform(
            translation=self.apply(child.translation[None, :])[0],
            rotation=self.rotation @ child.rotation,
            scale=self.scale * child.scale,
        )

    @staticmethod
    def identity() -> "Transform":
        return Transform(np.zeros(3), np.eye(3), 1.0)


@dataclass
class Block:
    index: int
    type: str
    name: str = ""
    transform: Transform = field(default_factory=Transform.identity)
    children: list[int] = field(default_factory=list)  # block refs
    collision: int = -1
    # geometry (BSTriShape)
    vertices: np.ndarray | None = None  # (n, 3) float64, local coordinates
    triangles: np.ndarray | None = None  # (m, 3) uint16
    vertex_flags: int = 0
    shader_property: int = -1  # block ref
    alpha_property: int = -1  # block ref; != -1 means alpha blending/testing (decals, grates)


@dataclass
class ShapeInstance:
    """A BSTriShape with its accumulated world transform (file space)."""

    block: Block
    world: Transform
    path: str  # node names from the root, "/"-joined

    @property
    def world_vertices(self) -> np.ndarray:
        return self.world.apply(self.block.vertices)


class NifFile:
    def __init__(self, source: Path | bytes) -> None:
        data = source if isinstance(source, (bytes, bytearray)) else Path(source).read_bytes()
        self.data = bytes(data)
        self.block_types: list[str] = []
        self.strings: list[str] = []
        self.blocks: list[Block] = []
        self.roots: list[int] = []
        self._parse()

    # -- parsing -----------------------------------------------------------------

    def _parse(self) -> None:
        r = _Reader(self.data)
        header_line = r.line()
        if not header_line.startswith("Gamebryo File Format, Version 20.2.0.7"):
            raise ValueError(f"unsupported NIF header: {header_line!r}")
        version = r.u32()
        endian = r.u8()
        user_version = r.u32()
        num_blocks = r.u32()
        bs_version = r.u32()
        if (version, endian, user_version, bs_version) != (SUPPORTED_VERSION, 1, SUPPORTED_USER_VERSION, SUPPORTED_BS_VERSION):
            raise ValueError(
                f"unsupported NIF variant: version=0x{version:x} endian={endian} "
                f"user={user_version} bs={bs_version}"
            )
        _author = r.export_string()
        _process_script = r.export_string()
        _export_script = r.export_string()

        num_block_types = r.u16()
        self.block_types = [r.sized_string() for _ in range(num_block_types)]
        type_index = list(r.unpack(f"{num_blocks}H")) if num_blocks else []
        block_sizes = list(r.unpack(f"{num_blocks}I")) if num_blocks else []
        num_strings = r.u32()
        _max_string_len = r.u32()
        self.strings = [r.sized_string() for _ in range(num_strings)]
        num_groups = r.u32()
        r.pos += 4 * num_groups

        for i in range(num_blocks):
            start = r.pos
            block_type = self.block_types[type_index[i]]
            block = Block(index=i, type=block_type)
            if block_type.endswith("Node"):
                self._parse_node(r, block)
            elif block_type == "BSTriShape":
                self._parse_bstrishape(r, block)
            self.blocks.append(block)
            r.pos = start + block_sizes[i]  # authoritative; skips unparsed tails

        num_roots = r.u32()
        self.roots = list(r.unpack(f"{num_roots}i")) if num_roots else []

    def _string(self, idx: int) -> str:
        return self.strings[idx] if 0 <= idx < len(self.strings) else ""

    def _parse_av_object(self, r: _Reader, block: Block) -> None:
        # NiObjectNET
        block.name = self._string(r.i32())
        r.refs()  # extra data
        r.i32()  # controller
        # NiAVObject (BS version > 26: 32-bit flags)
        r.u32()  # flags
        translation = r.vec3()
        m = r.unpack("9f")  # stored column by column: m11 m21 m31 m12 m22 m32 m13 m23 m33
        rotation = np.array(m, dtype=np.float64).reshape(3, 3).T
        scale = r.f32()
        block.transform = Transform(translation, rotation, scale)
        block.collision = r.i32()

    def _parse_node(self, r: _Reader, block: Block) -> None:
        self._parse_av_object(r, block)
        block.children = r.refs()
        # Effects follow (BS version < 130); derived-type fields after that are skipped
        # via the block size.

    def _parse_bstrishape(self, r: _Reader, block: Block) -> None:
        self._parse_av_object(r, block)
        r.vec3()  # bounding sphere center
        r.f32()  # bounding sphere radius
        r.i32()  # skin
        block.shader_property = r.i32()
        block.alpha_property = r.i32()
        desc = r.u64()
        vertex_size, position_bytes, flags = decode_vertex_desc(desc)
        num_triangles = r.u16()
        num_vertices = r.u16()
        data_size = r.u32()
        block.vertex_flags = flags
        if data_size == 0 or num_vertices == 0:
            block.vertices = np.zeros((0, 3))
            block.triangles = np.zeros((0, 3), dtype=np.uint16)
            return
        raw = np.frombuffer(self.data, dtype=np.uint8, count=num_vertices * vertex_size, offset=r.pos)
        raw = raw.reshape(num_vertices, vertex_size)
        if position_bytes == 16:
            block.vertices = raw[:, :12].copy().view("<f4").reshape(num_vertices, 3).astype(np.float64)
        else:
            block.vertices = raw[:, :6].copy().view("<f2").reshape(num_vertices, 3).astype(np.float64)
        r.pos += num_vertices * vertex_size
        tri = np.frombuffer(self.data, dtype="<u2", count=num_triangles * 3, offset=r.pos)
        block.triangles = tri.reshape(num_triangles, 3).copy()
        r.pos += num_triangles * 6

    # -- traversal ---------------------------------------------------------------

    def shapes(self) -> list[ShapeInstance]:
        """All BSTriShape blocks reachable from the roots, with world transforms."""
        out: list[ShapeInstance] = []

        def visit(ref: int, parent: Transform, path: str) -> None:
            if ref < 0 or ref >= len(self.blocks):
                return
            block = self.blocks[ref]
            world = parent.compose(block.transform)
            here = f"{path}/{block.name}" if path else block.name
            if block.type == "BSTriShape" and block.vertices is not None:
                out.append(ShapeInstance(block, world, here))
            for child in block.children:
                visit(child, world, here)

        for root in self.roots:
            visit(root, Transform.identity(), "")
        return out

    def all_world_vertices(self) -> np.ndarray:
        parts = [s.world_vertices for s in self.shapes() if len(s.block.vertices)]
        return np.vstack(parts) if parts else np.zeros((0, 3))
