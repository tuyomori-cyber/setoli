# Setoli 起動方式の検証記録と実装方針 v0.1

- 更新日：2026-10-27
- 状態：MVPの起動経路を確認済み
- 関連リポジトリ：`setoli`

## 1. 目的と前提

Setoli は、`~/score` 内の Markdown と PDF を Firefox ブックマークとして管理し、ファイル1件または最大10件を新規タブで開く。

- 対象は Foxbook 専用 Linux / Cage 環境。
- 対象形式は `~/score` 配下の `.md` と `.pdf` だけ。
- ファイル本体は読み取り・起動だけを行い、編集・移動・削除しない。
- Native Host は実パス、拡張子、最大10件を検証してから Firefox を起動する。

## 2. 検証結果

| 経路 | Surface 実機結果 | 判定 |
| --- | --- | --- |
| Firefox ブックマーク画面からの `file://` 起動 | 開く | 利用可能 |
| `firefox --new-tab file://…` 単体 | 開く | 利用可能 |
| `firefox --new-tab file://…` を10回指定 | 10件の新規タブが追加される | 利用可能 |
| WebExtension の `tabs.create({url: fileUrl})` | Firefox が `file:` URL を許可しない | 利用不可 |
| 拡張ページ内の通常の `<a href="file://…" target="_blank">` を直接タップ | 開かない | 利用不可 |
| Setoli Native Host からの起動（`~/score` へ修正後） | 開く | 利用可能 |

## 3. 初回失敗の原因と訂正

初期実装は対象ルートを `~/Dropbox` に固定していた。しかし Surface には `~/Dropbox` がなく、実際のファイルは `~/score` にあった。

Native Host は Firefox を起動する前にルートディレクトリ、実パス、形式を検証する。そのため `~/Dropbox` が存在しない状態では、Host が要求を拒否しており、Firefox への `--new-tab` 要求自体が実行されていなかった。

`~/score` へ切り替えた後、Setoli Native Host 経由でファイルが開くことを Surface 実機で確認した。従来の「`--no-remote` のため外部コマンドから開けない」「AutoConfig 連携が必須」という仮説は、ルート不一致による失敗を誤って原因と判断したものだったため撤回する。

Surface の kiosk 起動にある `--no-remote --new-instance` は変更しない。現行の Native Host 起動方式が実機で機能しているため、Firefox 本体の AutoConfig 改修は不要である。

## 4. 現行実装方針

```text
Setoli拡張
  → Native Messaging
  → Setoli Native Host
     - ~/score 配下か検証
     - .md / .pdf だけ許可
     - 最大10件を検証
     - Firefox --new-tab file://… を引数配列で起動
```

Native Host はシェルを介さずに Firefox を実行する。拡張が直接 `file://` を開く経路は使わない。

## 5. 今後の実機確認

1. `~/score` からのファイル追加、単体起動、10件一括起動。
2. 移動後ファイルの SHA-256 による自動修復。
3. 同一 SHA-256 候補が複数ある場合の「要確認」表示。
4. `~/score` 外のパス、対応外形式、範囲外へ出るシンボリックリンクの拒否。

## 6. 保留事項

- 現行の Firefox 起動方式が、常に既存の kiosk ウィンドウへ追加するか、新規ウィンドウを作ることがあるかを、日常利用の複数回起動で確認する。
- Firefox 実行ファイルの設定は Host インストール時の `--firefox` 引数に依存する。Surface では kiosk が使う実行ファイルを同じ引数で指定する。
