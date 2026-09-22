"""
List or extract files from the game's BSA archives.

Examples (from the repo root):

    python tools/bsa_extract.py --list --filter meshes/dungeons/imperial/
    python tools/bsa_extract.py --filter meshes/dungeons/imperial/ --suffix .nif --out tools/out/nif

The game root is found automatically (registry, then Steam library folders) unless
`--game` is given. Archives default to `Skyrim - Meshes*.bsa`; pass `--archive` (glob,
repeatable) for others. Later archives in the glob order override earlier ones with the
same path, which mirrors the game's own load order for the base game meshes.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from bsa import BsaArchive, BsaEntry
from game_root import find_game_root


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--game", type=Path, help="game root (folder containing Data/)")
    parser.add_argument(
        "--archive",
        action="append",
        default=None,
        help="archive glob relative to Data/ (default: 'Skyrim - Meshes*.bsa'); repeatable",
    )
    parser.add_argument("--filter", default="", help="path prefix inside the archive, e.g. meshes/dungeons/imperial/")
    parser.add_argument("--suffix", default="", help="path suffix, e.g. .nif")
    parser.add_argument("--list", action="store_true", help="list matching files instead of extracting")
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "out" / "extracted", help="output folder")
    args = parser.parse_args(argv)

    game_root = args.game or find_game_root()
    if game_root is None or not (game_root / "Data").is_dir():
        print("Game root not found; pass --game <folder containing Data/>", file=sys.stderr)
        return 2
    data_dir = game_root / "Data"

    archives: list[Path] = []
    for pattern in args.archive or ["Skyrim - Meshes*.bsa"]:
        archives.extend(sorted(data_dir.glob(pattern)))
    if not archives:
        print(f"No archive matches in {data_dir}", file=sys.stderr)
        return 2

    # Later archives win on duplicate paths.
    selected: dict[str, tuple[Path, BsaEntry]] = {}
    for archive_path in archives:
        with BsaArchive(archive_path) as bsa:
            for entry in bsa.find(args.filter, args.suffix):
                selected[entry.path] = (archive_path, entry)

    if args.list:
        for path, (archive_path, entry) in sorted(selected.items()):
            flag = "z" if entry.compressed else "-"
            print(f"{flag} {entry.size:>10}  {archive_path.name:<24} {path}")
        print(f"{len(selected)} file(s)", file=sys.stderr)
        return 0

    started = time.perf_counter()
    written = 0
    by_archive: dict[Path, list[BsaEntry]] = {}
    for archive_path, entry in selected.values():
        by_archive.setdefault(archive_path, []).append(entry)
    for archive_path, entries in by_archive.items():
        with BsaArchive(archive_path) as bsa:
            for entry in entries:
                target = args.out / entry.path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(bsa.read(entry))
                written += 1
    print(
        f"{written} file(s) written to {args.out} in {time.perf_counter() - started:.1f}s",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
