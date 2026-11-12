# 反応ライブラリの対応情報付きZIP（v1）

元Sitesの `reactions.html` で「選択分を対応情報付きZIPで保存」または「全件を対応情報付きZIPで保存」を使う。読み取り専用の書き出しであり、既存レコード・ID・保存先・従来のXYZのみのZIPを変更しない。

- ルートの `reaction-library.json`: format=`mol-bench-reaction-library`, version=1、archiveId、source.origin、件数、反応一覧。
- 各反応は既存のreactionIdと、START/FINISHの役割別参照を持つ。structureIdはreactionIdと役割の組であり、revisionはその構造版。未作成の役割はnull。名前・ZIP内のファイル名からペアを推定しない。
- ZIP内のパスはランダムなフォルダーで分離し、反応名に依存しない。同名・改名・スラッシュを含むIDでも衝突しない。
- 各参照はpath、bytes、SHA-256を持つ。完全な復元ではすべての参照を検証し、記録内のidとmanifestのreactionIdが一致すること、START/FINISH参照との一致を確認する。矛盾・欠損は推測して修復しない。
- 各反応の `record.json` はレコード全体の型付き値。JSON基本型はそのまま、objectはentries、arrayはitems。blobはmimeと参照先ファイル、binaryはconstructorと参照、dateはISO値。undefined、非有限数と負のゼロも明示する。未対応の型は黙って捨てず出力を停止する。
- 原XYZ Blobは元のバイト列を別ファイルで保持する。原子順・座標の数値・付加属性・メモ・タグ・反応作成日時・revision・プレビューなど、元レコードの全フィールドを含む。
- START.xyz / FINISH.xyz は従来と同じ空コメントの計算用出力。復元用の精度や原文はrecord.jsonとBlobに保持する。計算用XYZだけを再読込して完全なバックアップと扱わない。

この変更の対象は元Sitesの書き出し。Firebase側の対応情報付きZIP取り込みは別途、この形式の検証とID競合確認を実装してから提供する。既存の名前だけのZIPから自動でペアを推測しない。

検証: `node tests/test.cjs`（既存20件）と `node tests/reaction-archive.test.cjs`（同名、改名、欠落役割、メタデータ・原文の復元、参照ハッシュ、独立したPython zipfileによるCRC検証）。
