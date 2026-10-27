#!/usr/bin/python3
"""Native Messaging host for Setoli.

Only files resolved under ~/score and ending in .md or .pdf are accepted.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
from typing import Any, Callable
from urllib.parse import quote, unquote, urlparse


HOST_NAME = "setoli"
MAX_REQUEST_BYTES = 1_000_000
MAX_OPEN_FILES = 10
MAX_REPAIR_RECORDS = 2_000
SUPPORTED_SUFFIXES = {".md", ".pdf"}
SCORE_ROOT = Path.home() / "score"
CONFIG_PATH = Path(__file__).resolve().with_name("config.json")


def response(success: bool, *, data: Any = None, code: str | None = None, message: str = "") -> dict[str, Any]:
    return {"success": success, "data": data, "error": None if success else {"code": code, "message": message}}


def inside_root(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def checked_root(root: Path = SCORE_ROOT) -> Path:
    resolved = root.resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError("scoreフォルダを確認できません。")
    return resolved


def checked_file(path: Path, root: Path) -> Path:
    resolved = path.resolve(strict=True)
    if not resolved.is_file() or not inside_root(resolved, root):
        raise ValueError("score内の通常ファイルを指定してください。")
    if resolved.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise ValueError("対応形式は Markdown と PDF だけです。")
    return resolved


def path_from_file_url(value: str, root: Path) -> Path:
    parsed = urlparse(value)
    if parsed.scheme != "file" or parsed.netloc not in ("", "localhost"):
        raise ValueError("file:// URLを指定してください。")
    return checked_file(Path(unquote(parsed.path)), root)


def file_url(path: Path) -> str:
    return "file://" + quote(str(path), safe="/%:@")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fingerprint(path: Path, root: Path) -> dict[str, Any]:
    checked = checked_file(path, root)
    stat = checked.stat()
    return {
        "url": file_url(checked),
        "name": checked.name,
        "relativePath": str(checked.relative_to(root)),
        "size": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
        "sha256": sha256(checked),
    }


def list_directory(relative_path: str, root: Path) -> dict[str, Any]:
    if not isinstance(relative_path, str):
        raise ValueError("フォルダ指定が正しくありません。")
    candidate = (root / relative_path).resolve(strict=True)
    if not candidate.is_dir() or not inside_root(candidate, root):
        raise ValueError("score内のフォルダを指定してください。")
    folders, files = [], []
    for entry in sorted(candidate.iterdir(), key=lambda item: (not item.is_dir(), item.name.casefold())):
        try:
            resolved = entry.resolve(strict=True)
        except OSError:
            continue
        if not inside_root(resolved, root):
            continue
        relative = str(resolved.relative_to(root))
        if resolved.is_dir():
            folders.append({"name": resolved.name, "relativePath": relative})
        elif resolved.is_file() and resolved.suffix.lower() in SUPPORTED_SUFFIXES:
            files.append({"name": resolved.name, "relativePath": relative, "url": file_url(resolved)})
    return {"path": str(candidate.relative_to(root)), "folders": folders, "files": files}


def find_repair_candidates(record: dict[str, Any], root: Path) -> list[Path]:
    size, expected_hash = record.get("size"), record.get("sha256")
    if type(size) is not int or size < 0 or not isinstance(expected_hash, str) or len(expected_hash) != 64:
        raise ValueError("修復用メタデータが正しくありません。")
    matches = []
    for path in root.rglob("*"):
        try:
            resolved = path.resolve(strict=True)
            if not resolved.is_file() or not inside_root(resolved, root) or resolved.suffix.lower() not in SUPPORTED_SUFFIXES:
                continue
            if resolved.stat().st_size == size and sha256(resolved) == expected_hash:
                matches.append(resolved)
        except OSError:
            continue
    return matches


def repair(records: list[Any], root: Path) -> list[dict[str, Any]]:
    if not isinstance(records, list) or len(records) > MAX_REPAIR_RECORDS:
        raise ValueError("検査件数が正しくありません。")
    results = []
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("bookmarkId"), str) or not isinstance(record.get("url"), str):
            raise ValueError("検査データが正しくありません。")
        bookmark_id = record["bookmarkId"]
        try:
            current = path_from_file_url(record["url"], root)
            results.append({"bookmarkId": bookmark_id, "status": "ok", "fingerprint": fingerprint(current, root)})
        except (OSError, ValueError):
            matches = find_repair_candidates(record, root)
            if len(matches) == 1:
                results.append({"bookmarkId": bookmark_id, "status": "repaired", "fingerprint": fingerprint(matches[0], root)})
            elif len(matches) > 1:
                results.append({"bookmarkId": bookmark_id, "status": "ambiguous"})
            else:
                results.append({"bookmarkId": bookmark_id, "status": "missing"})
    return results


def firefox_command(urls: list[Any], root: Path, config_path: Path = CONFIG_PATH) -> list[str]:
    if not isinstance(urls, list) or not 1 <= len(urls) <= MAX_OPEN_FILES or not all(isinstance(url, str) for url in urls):
        raise ValueError(f"開けるファイル数は1から{MAX_OPEN_FILES}件です。")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    firefox = config.get("firefox") if isinstance(config, dict) else None
    if not isinstance(firefox, str) or not Path(firefox).is_absolute() or not os.access(firefox, os.X_OK):
        raise ValueError("Foxbook Firefoxの設定を確認できません。")
    command = [firefox]
    for url in urls:
        command.extend(("--new-tab", file_url(path_from_file_url(url, root))))
    return command


def process_request(request: Any, *, root: Path = SCORE_ROOT, run: Callable[..., Any] = subprocess.run, config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    if not isinstance(request, dict) or not isinstance(request.get("action"), str):
        return response(False, code="INVALID_REQUEST", message="要求の形式が正しくありません。")
    try:
        safe_root = checked_root(root)
        action = request["action"]
        if action == "list_directory" and set(request) == {"action", "relativePath"}:
            return response(True, data=list_directory(request["relativePath"], safe_root))
        if action == "fingerprint" and set(request) == {"action", "url"} and isinstance(request["url"], str):
            return response(True, data=fingerprint(path_from_file_url(request["url"], safe_root), safe_root))
        if action == "repair" and set(request) == {"action", "records"}:
            return response(True, data=repair(request["records"], safe_root))
        if action == "open" and set(request) == {"action", "urls"}:
            command = firefox_command(request["urls"], safe_root, config_path)
            completed = run(command, capture_output=True, text=True, timeout=30, check=False)
            if completed.returncode != 0:
                return response(False, code="FIREFOX_FAILED", message="Firefoxでファイルを開けませんでした。")
            return response(True, data={"opened": len(request["urls"])})
        return response(False, code="INVALID_REQUEST", message="要求の形式が正しくありません。")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return response(False, code="COMMAND_FAILED", message=str(exc))
    except subprocess.TimeoutExpired:
        return response(False, code="TIMEOUT", message="Firefoxの起動が時間内に完了しませんでした。")


def read_exact(stream: Any, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        block = stream.read(size - len(data))
        if not block:
            raise EOFError
        data.extend(block)
    return bytes(data)


def read_message(stream: Any) -> Any:
    header = read_exact(stream, 4)
    size = struct.unpack("=I", header)[0]
    if size > MAX_REQUEST_BYTES:
        raise ValueError("要求が大きすぎます。")
    return json.loads(read_exact(stream, size).decode("utf-8"))


def write_message(stream: Any, payload: dict[str, Any]) -> None:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    stream.write(struct.pack("=I", len(data)))
    stream.write(data)
    stream.flush()


def main() -> int:
    try:
        request = read_message(sys.stdin.buffer)
        result = process_request(request)
    except (EOFError, ValueError, json.JSONDecodeError) as exc:
        result = response(False, code="INVALID_REQUEST", message=str(exc))
    write_message(sys.stdout.buffer, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
