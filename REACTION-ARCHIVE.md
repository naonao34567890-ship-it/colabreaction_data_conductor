# 反応ライブラリの対応情報付きZIP（v1）

元Sitesの `reactions.html` で「選択分を対応情報付きZIPで保存」または「全件を対応情報付きZIPで保存」を使う。読み取り専用の書き出しであり、既存レコード・ID・保存先・従来のXYZのみのZIPを変更しない。

- ルートの `reaction-library.json`: format=`mol-bench-reaction-library`, version=1、archiveId、source.origin、件数、反応一覧。
- 各反応は既存のreactionIdと、START/FINISHの役割別参照を持つ。structureIdはreactionIdと役割の組であり、revisionはその構造版。未作成の役割はnull。名前・ZIP内のファイル名からペアを推定しない。
- ZIP内のパスはランダムなフォルダーで分離し、反応名に依存しない。同名・改名・スラッシュを含むIDでも衝突しない。
- 各参照はpath、bytes、SHA-256を持つ。完全な復元ではすべての参照を検証し、記録内のidとmanifestのreactionIdが一致すること、START/FINISH参照との一致を確認する。矛盾・欠損は推測して修復しない。
- 各反応の `record.json` はレコード全体の型付き値。JSON基本型はそのまま、objectはentries、arrayはitems。blobはmimeと参照先ファイル、binaryはconstructorと参照、dateはISO値。undefined、非有限数と負のゼロも明示する。未対応の型は黙って捨てず出力を停止する。
- 原XYZ Blobは元のバイト列を別ファイルで保持する。原子順・座標の数値・付加属性・メモ・タグ・反応作成日時・revision・プレビューなど、元レコードの全フィールドを含む。
- START.xyz / FINISH.xyz は従来と同じ空コメントの計算用出力。復元用の精度や原文はrecord.jsonとBlobに保持する。計算用XYZだけを再読込して完全なバックアップと扱わない。

Firebase版の `reactions.html` ではZIPをそのままドロップ、または「ZIPを選択して取り込む」。ZIP全体を検証した後に確認画面を表示し、現在接続しているGoogle Driveへ保存する。START/FINISHのXYZがrecord内の構造と一致することも確認する。

同じID・同じ内容はスキップする。名前、タグ、原文、構造などが異なる同じIDが1件でもあれば、ZIP内の新規分も含めて保存前に停止する。新規データは元の反応IDを保って一つのカタログ更新で反映し、他端末との同時更新時も再検査する。プレビューなどの実行時キャッシュは同一性の比較対象から除く。既存の名前だけのZIPから自動でペアを推測しない。

ZIPと展開後の合計は各512 MiB、ファイル数は5万まで。超える場合は元Sitesの選択分を書き出す。ZIP内の重複パス、絶対パス、親ディレクトリ参照、ID重複、役割の矛盾、欠損、ハッシュ不一致は拒否する。fflate 0.8.2（MIT）をローカル配信し、展開時に外部CDNは不要。Drive上の新規保存は日付・型付き配列・undefined・負のゼロも保持し、旧形式の読出しと移行済み判定のハッシュは互換性を維持する。

検証: `node tests/test.cjs`（既存20件）と `node tests/reaction-archive.test.cjs`（同名、改名、欠落役割、メタデータ・原文の復元、参照ハッシュ、独立したPython zipfileによるCRC検証）。
