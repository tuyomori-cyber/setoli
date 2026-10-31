#!/usr/bin/python3
"""Install Setoli's user-level Native Messaging host."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys


HOST_NAME = "setoli"
EXTENSION_ID = "setoli@foxbook.example"
SOURCE_HOST = Path(__file__).resolve().parents[1] / "native_host" / "setoli.py"


def validate_firefox(firefox: Path) -> Path:
    if not firefox.is_absolute() or not firefox.is_file() or not os.access(firefox, os.X_OK):
        raise ValueError("--firefox には実行可能な絶対パスを指定してください。")
    resolved = firefox.resolve(strict=True)
    if "snap" in resolved.parts or "flatpak" in resolved.parts:
        raise ValueError("Snap／Flatpak版Firefoxは対象外です。")
    return resolved


def install(firefox: Path, home: Path) -> None:
    firefox = validate_firefox(firefox)
    if not SOURCE_HOST.is_file():
        raise ValueError("Native Hostのソースが見つかりません。")
    host_dir = home / ".local" / "share" / "setoli"
    host_path = host_dir / "setoli.py"
    config_path = host_dir / "config.json"
    manifest_path = home / ".mozilla" / "native-messaging-hosts" / f"{HOST_NAME}.json"
    host_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE_HOST, host_path)
    os.chmod(host_path, 0o700)
    config: dict[str, object] = {}
    if config_path.is_file():
        try:
            saved = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                config = saved
        except (OSError, json.JSONDecodeError):
            pass
    config["firefox"] = str(firefox)
    config_path.write_text(json.dumps(config, ensure_ascii=False) + "\n", encoding="utf-8")
    os.chmod(config_path, 0o600)
    manifest_path.write_text(json.dumps({
        "name": HOST_NAME,
        "description": "Setoli Native Host",
        "path": str(host_path),
        "type": "stdio",
        "allowed_extensions": [EXTENSION_ID],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(manifest_path, 0o600)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--firefox", required=True, type=Path)
    args = parser.parse_args()
    try:
        install(args.firefox, Path.home())
    except (OSError, ValueError) as exc:
        print(f"インストール失敗: {exc}", file=sys.stderr)
        return 1
    print("Setoli Native Hostを登録しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
