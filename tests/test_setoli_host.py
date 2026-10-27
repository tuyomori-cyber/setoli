from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "native_host"))
import setoli  # noqa: E402


class SetoliHostTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "score"
        self.root.mkdir()
        self.config = Path(self.temp.name) / "config.json"
        self.firefox = Path(self.temp.name) / "firefox"
        self.firefox.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        self.firefox.chmod(0o700)
        self.config.write_text(json.dumps({"firefox": str(self.firefox)}), encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def add(self, name: str, content: str = "test") -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_fingerprint_rejects_outside_and_unsupported_files(self) -> None:
        outside = Path(self.temp.name) / "outside.md"
        outside.write_text("x", encoding="utf-8")
        unsupported = self.add("notes.txt")
        with self.assertRaises(ValueError):
            setoli.fingerprint(outside, self.root.resolve())
        with self.assertRaises(ValueError):
            setoli.fingerprint(unsupported, self.root.resolve())

    def test_list_directory_returns_only_supported_files_and_folders(self) -> None:
        self.add("folder/readme.MD")
        self.add("shown.pdf")
        self.add("hidden.txt")
        result = setoli.list_directory("", self.root.resolve())
        self.assertEqual([item["name"] for item in result["folders"]], ["folder"])
        self.assertEqual([item["name"] for item in result["files"]], ["shown.pdf"])

    def test_repair_updates_a_uniquely_moved_file(self) -> None:
        old = self.add("old.md", "same contents")
        record = {"bookmarkId": "42", **setoli.fingerprint(old, self.root.resolve())}
        old.unlink()
        moved = self.add("nested/new.md", "same contents")
        result = setoli.repair([record], self.root.resolve())
        self.assertEqual(result[0]["status"], "repaired")
        self.assertEqual(result[0]["fingerprint"]["url"], setoli.file_url(moved.resolve()))

    def test_repair_keeps_ambiguous_duplicates_unresolved(self) -> None:
        old = self.add("old.md", "same contents")
        record = {"bookmarkId": "42", **setoli.fingerprint(old, self.root.resolve())}
        old.unlink()
        self.add("a.md", "same contents")
        self.add("b.md", "same contents")
        result = setoli.repair([record], self.root.resolve())
        self.assertEqual(result, [{"bookmarkId": "42", "status": "ambiguous"}])

    def test_open_builds_repeated_new_tab_arguments(self) -> None:
        first = self.add("first.md").resolve()
        second = self.add("second.pdf").resolve()
        command = setoli.firefox_command([setoli.file_url(first), setoli.file_url(second)], self.root.resolve(), self.config)
        self.assertEqual(command, [str(self.firefox), "--new-tab", setoli.file_url(first), "--new-tab", setoli.file_url(second)])

    def test_open_rejects_more_than_ten_files(self) -> None:
        path = self.add("one.md").resolve()
        with self.assertRaises(ValueError):
            setoli.firefox_command([setoli.file_url(path)] * 11, self.root.resolve(), self.config)

    def test_process_open_uses_validated_command(self) -> None:
        path = self.add("one.md").resolve()
        calls: list[list[str]] = []
        def run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            return subprocess.CompletedProcess(command, 0, "", "")
        result = setoli.process_request({"action": "open", "urls": [setoli.file_url(path)]}, root=self.root, run=run, config_path=self.config)
        self.assertTrue(result["success"])
        self.assertEqual(calls[0][1:], ["--new-tab", setoli.file_url(path)])


if __name__ == "__main__":
    unittest.main()
