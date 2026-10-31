# Setoli

Foxbook専用 Firefox で、端末ごとに設定したローカルルート内の Markdown と PDF を管理・起動するローカルブックマークマネージャーです。

初回起動時に端末名とルートディレクトリを登録します。各端末は `Setoli/<端末名>` のブックマーク領域だけを管理し、Firefox Sync で同居する他端末のブックマークは表示・操作しません。ルートディレクトリは Setting から後で変更できます。

詳細は [仕様書](setoli_仕様書_v0.1.0.md) を参照してください。

## 使い方

- `Setoli` ルートにはセット用のフォルダを作成します。ファイルはルートへ直接追加せず、開いたディレクトリ内へ追加します。
- `AllOpen` は現在開いているディレクトリ直下の登録ファイルだけを、最大10件まで新規タブで開きます。子ディレクトリやルートのファイルをまとめて開くことはありません。
- ファイルは左端のドラッグハンドルで同じディレクトリ内の順序を変更できます。削除は右端の︙メニューから行います。

## 開発時の導入

```bash
python3 scripts/install_host.py --firefox "$HOME/.local/opt/foxbook-firefox/firefox"
```

Firefox の `about:debugging` で `extension/manifest.json` を一時読み込みします。Native Host を更新したときは、インストーラーをもう一度実行します。

v0.1.1以降は、初回登録またはルートディレクトリ変更の前にも、最新の Native Host をインストールしてください。

## 試験

```bash
python3 -m unittest discover -s tests -v
```
