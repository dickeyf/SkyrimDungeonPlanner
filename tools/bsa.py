"""
Minimal reader for Skyrim SE BSA archives (version 105).

Read-only. Reads the folder/file tables once, then fetches individual files by ranged
reads so a 1 GB archive never has to be loaded into memory. Compressed entries use the
LZ4 frame format (`lz4.frame`).

Format reference: https://en.uesp.net/wiki/Skyrim_Mod:Archive_File_Format
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterator

import lz4.frame

BSA_MAGIC = b"BSA\x00"
BSA_VERSION_SSE = 105

# Archive flags
FLAG_HAS_FOLDER_NAMES = 0x001
FLAG_HAS_FILE_NAMES = 0x002
FLAG_COMPRESSED_BY_DEFAULT = 0x004
FLAG_EMBED_FILE_NAMES = 0x100

# File record size field
SIZE_COMPRESSION_TOGGLE = 0x40000000
SIZE_MASK = 0x3FFFFFFF

HEADER_STRUCT = struct.Struct("<4sIIIIIIIHH")  # 36 bytes
FOLDER_RECORD_STRUCT = struct.Struct("<QIIQ")  # 24 bytes (v105)
FILE_RECORD_STRUCT = struct.Struct("<QII")  # 16 bytes


@dataclass(frozen=True)
class BsaEntry:
    """One file inside the archive. `path` uses forward slashes, lowercase."""

    path: str
    offset: int
    size: int  # size on disk, including the embedded name and the original-size field
    compressed: bool


class BsaArchive:
    def __init__(self, file_path: Path) -> None:
        self.file_path = Path(file_path)
        self._fh: BinaryIO = open(self.file_path, "rb")
        self.flags = 0
        self.entries: dict[str, BsaEntry] = {}
        self._read_tables()

    def __enter__(self) -> "BsaArchive":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._fh.close()

    # -- tables ----------------------------------------------------------------------

    def _read_tables(self) -> None:
        fh = self._fh
        header = fh.read(HEADER_STRUCT.size)
        (
            magic,
            version,
            folder_offset,
            flags,
            folder_count,
            file_count,
            _total_folder_name_len,
            total_file_name_len,
            _file_flags,
            _pad,
        ) = HEADER_STRUCT.unpack(header)
        if magic != BSA_MAGIC:
            raise ValueError(f"{self.file_path}: not a BSA archive")
        if version != BSA_VERSION_SSE:
            raise ValueError(f"{self.file_path}: BSA version {version}, expected {BSA_VERSION_SSE}")
        if not (flags & FLAG_HAS_FOLDER_NAMES and flags & FLAG_HAS_FILE_NAMES):
            raise ValueError(f"{self.file_path}: archive without folder/file names is unsupported")
        self.flags = flags

        fh.seek(folder_offset)
        folders = [
            FOLDER_RECORD_STRUCT.unpack(fh.read(FOLDER_RECORD_STRUCT.size))
            for _ in range(folder_count)
        ]

        # File record blocks follow immediately, one per folder, in the same order.
        # (The folder record's own offset field points there too, biased by
        # total_file_name_len; sequential reading avoids relying on it.)
        per_folder: list[tuple[str, list[tuple[int, bool]]]] = []
        default_compressed = bool(flags & FLAG_COMPRESSED_BY_DEFAULT)
        for _hash, count, _pad, _offset in folders:
            name_len = fh.read(1)[0]
            folder_name = fh.read(name_len)[:-1].decode("cp1252")  # strip trailing NUL
            records = []
            for _ in range(count):
                _fhash, size, offset = FILE_RECORD_STRUCT.unpack(fh.read(FILE_RECORD_STRUCT.size))
                compressed = default_compressed != bool(size & SIZE_COMPRESSION_TOGGLE)
                records.append((offset, size & SIZE_MASK, compressed))
            per_folder.append((folder_name, records))

        names_block = fh.read(total_file_name_len)
        names = names_block.split(b"\x00")
        if len(names) - 1 < file_count:
            raise ValueError(f"{self.file_path}: file name block is truncated")

        i = 0
        for folder_name, records in per_folder:
            prefix = folder_name.replace("\\", "/").lower()
            for offset, size, compressed in records:
                file_name = names[i].decode("cp1252")
                i += 1
                path = f"{prefix}/{file_name.lower()}" if prefix else file_name.lower()
                self.entries[path] = BsaEntry(path, offset, size, compressed)

    # -- access ----------------------------------------------------------------------

    def __contains__(self, path: str) -> bool:
        return normalize(path) in self.entries

    def __iter__(self) -> Iterator[BsaEntry]:
        return iter(self.entries.values())

    def find(self, prefix: str = "", suffix: str = "") -> list[BsaEntry]:
        prefix = normalize(prefix)
        suffix = suffix.lower()
        return [
            e
            for e in self.entries.values()
            if e.path.startswith(prefix) and e.path.endswith(suffix)
        ]

    def read(self, path: str | BsaEntry) -> bytes:
        entry = path if isinstance(path, BsaEntry) else self.entries[normalize(path)]
        fh = self._fh
        fh.seek(entry.offset)
        raw = fh.read(entry.size)
        pos = 0
        if self.flags & FLAG_EMBED_FILE_NAMES:
            pos = 1 + raw[0]  # bstring without NUL: skip length byte + name
        if not entry.compressed:
            return raw[pos:]
        (original_size,) = struct.unpack_from("<I", raw, pos)
        data = lz4.frame.decompress(raw[pos + 4 :])
        if len(data) != original_size:
            raise ValueError(
                f"{entry.path}: decompressed {len(data)} bytes, header says {original_size}"
            )
        return data


def normalize(path: str) -> str:
    return path.replace("\\", "/").lower().strip("/")
