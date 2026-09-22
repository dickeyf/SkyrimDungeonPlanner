"""
Merge the R5 reports into a provisional piece table for the R10 proof of concept:
model file name -> subkit, pivot, cells. Written to poc/data/imperial-pieces.json.

Pivot Z is set to 0 (the NIF origin defines the Z slice, D55); R5's floor-based pivot Z is
kept as `floorZ` for information. R5 indexes cells relative to the NIF origin; the catalogue
wants them relative to the piece's min corner (cell (0,0,0) present), so they are shifted.

    python tools/export_r5_catalogue.py
"""

from __future__ import annotations

import json
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "poc" / "data"
REPORTS = Path(__file__).parent / "out"
SUBKITS = ["smallhall", "largehall", "smallroom", "largeroom"]


def main() -> None:
    pieces = {}
    for subkit in SUBKITS:
        report = json.loads((REPORTS / f"r5-{subkit}-128.json").read_text())
        for p in report["pieces"]:
            if not p["openings"]:
                continue  # props (brace, pillar) are not tiles
            cells = [c for c in p["cells"] if c[2] == 0] or p["cells"]
            mins = [min(c[i] for c in cells) for i in range(3)]
            cells = [[c[0] - mins[0], c[1] - mins[1], c[2] - mins[2]] for c in cells]
            pieces[p["file"].lower()] = {
                "subkit": subkit,
                "pivot": [p["pivot"][0], p["pivot"][1], 0.0],
                "floorZ": p["floor_z"],
                "cells": cells,
                "fits": p["fits"],
                "openings": [o["dir"] for o in p["openings"]],
            }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "imperial-pieces.json"
    out.write_text(json.dumps({"module": 128, "zModule": 128, "pieces": pieces}, indent=1), encoding="utf-8")
    print(f"wrote {out}: {len(pieces)} pieces")


if __name__ == "__main__":
    main()
