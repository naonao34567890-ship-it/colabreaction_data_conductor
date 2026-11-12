# Driveを正本にする保存層変更の確認表

## 訂正された要件

「今ある内容を極力消さない」は、既存機能を削らないという要求。独立したバックアップ／追加復元方式は要求を満たさないため撤回した。

移行後の分子・反応ライブラリは同一のクラウド上のID・データを使う。ローカルはキャッシュと未保存操作の保持に限定する。別々に編集される2つの正本を作らない。

この文書は実装の確認表であり、Drive正本方式の実装完了を示さない。

## 実装から確認した保存経路

| 経路 | 実装 | 保存層変更で維持する動作 |
| --- | --- | --- |
| XYZ/SDF/pyxyz、QM9、複数分子、フォルダー登録 | common.js parseFile/saveBatch、worker.js ImportJob、index.html | 解析ルール、改行・余分な情報の保持、名前重複処理、範囲・スライドショー、キュー、進捗、中止、部分成功、大量処理 |
| 分子一覧 | common.js metadata/get/VirtualGrid、index.html | 軽量メタデータ、並び順、選択、仮想化、遅延サムネイル、組み込み分子、別タブ更新 |
| 分子新規・上書き・名前変更・削除 | common.js saveBatch/overwrite/renameMolecule/removeMany、editor.html/index.html | 同じIDで上書き、revisionによる競合検出、同名防止、新規タブでのID参照、ショートカット |
| 分子タグ一覧・作成・改名・未使用削除・付与・解除 | library-tags.js transact | metaだけでなくtagsストアへ直接書き込む経路も対象。使用中削除禁止、一括更新、別タブ通知 |
| 分子出力 | common.js output/calculationOutput、worker.js exportData、editor.html | XYZ/pyxyz/ZIP/ZIP64/連結、メモ、原文、標準化、分割書き込み、進捗、中止、容量制限 |
| 3D編集 | editor.html、common.js graphics | 表示形式、原子番号、選択・投げ縄、移動・回転、モイエティ交換、特別な点、分子追加、Undo/Redo |
| 最適化 | optimize-ui.js、optimize-worker.js、xtb/、xtbloom/ | GFN1/GFN2、条件、進捗、中止、前後比較、適用とUndo、エネルギー、計算ログ |
| 反応読込・新規・更新・タグ・削除 | reaction-store.js 全公開関数 | START/FINISH単独・両方、名前、タグ、日時、片方変更時も他方を保持、revision競合チェック |
| 反応保存先の選択 | reaction-editor.js、editor.html | 新規・既存・現在の反応、START/FINISH、構造名、上書き確認、既存IDを維持 |
| 反応一覧・出力 | reactions.js、reactions.html | 日別表示、サムネイル、選択、名前変更、タグ、一括削除、ZIP |
| 軌跡・スライドショー | slideshow.js、align-geometry.js、frame-energy.js、dmf-energy.js | フレーム表示、エネルギー、整列、フレームからSTART/FINISH・反応新規作成、画像保存 |
| Colab計算記録 | colab-records.js | 既存Driveフォルダー・ZIP/フォルダー登録、画像、エネルギー、軌跡、分類・改名、備考、結果ZIP出力、処理キュー |
| Drive継続接続 | drive-connection.js、standalone-drive/worker.mjs | Googleアカウントの接続、セッション復元、期限更新、アカウント分離、シークレットをブラウザへ出さない |

REQUIREMENTS.mdの58要件、VALIDATION.md、README.mdだけでは後付け機能を網羅しないため、上記の実装ファイルも確認対象とする。

## 新しい保存層に必要な条件

- Worker内の分子登録、通常画面の分子保存、タグ画面の直接トランザクション、反応ストア、スライドショーの反応保存を同じ保存経路に統一する。
- IDと構造リビジョンを維持する。クラウド復元時に新しいIDを振り直して重複を増やす方式を使わない。
- 読んだ版と保存先の版を照合する。別端末・別タブの変更を検出したら黙って上書きしない。
- クラウド保存完了と端末にだけ残る未保存状態を区別する。失敗時に成功と表示しない。
- アカウントが変わったら正本とキャッシュを分離する。他アカウントのキャッシュを自動送信しない。
- 初回移行は全データのアップロードと整合性確認を終えるまで元のデータを残す。移行済みのローカルは独立した編集先にしない。
- サムネイル等の再生成可能なキャッシュ変更をクラウド上の構造更新と混同しない。
- 数万件を想定した既存の軽量一覧、バッチ、Worker、ストリーム出力を、保存のたびの全件読込で置き換えない。

## 必要な回帰確認

既存20テストとDrive接続テストに加え、上表の保存経路別に新規・変更・削除・失敗・再読込を検証する。特に別タブと別端末の同時変更、古い画面からの上書き、通信断、中止、アカウント切替、移行途中からの再開を確認する。公開済みの仕様書にある未検証事項を、移行の検証済み項目と混同しない。
