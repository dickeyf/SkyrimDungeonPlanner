"""Locate the Skyrim Special Edition install folder on Windows."""

from __future__ import annotations

import re
import sys
from pathlib import Path

GAME_FOLDER = "Skyrim Special Edition"


def find_game_root() -> Path | None:
    for candidate in _candidates():
        if (candidate / "Data" / "Skyrim.esm").is_file():
            return candidate
    return None


def _candidates():
    if sys.platform != "win32":
        return
    import winreg

    for hive_key in (
        r"SOFTWARE\WOW6432Node\Bethesda Softworks\Skyrim Special Edition",
        r"SOFTWARE\Bethesda Softworks\Skyrim Special Edition",
    ):
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, hive_key) as key:
                value, _ = winreg.QueryValueEx(key, "installed path")
                yield Path(value)
        except OSError:
            pass

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            steam_path, _ = winreg.QueryValueEx(key, "SteamPath")
    except OSError:
        return
    vdf = Path(steam_path) / "steamapps" / "libraryfolders.vdf"
    if not vdf.is_file():
        return
    for match in re.finditer(r'"path"\s+"([^"]+)"', vdf.read_text(encoding="utf-8", errors="replace")):
        library = Path(match.group(1).replace("\\\\", "\\"))
        yield library / "steamapps" / "common" / GAME_FOLDER
