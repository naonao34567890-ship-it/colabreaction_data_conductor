'use strict';
const sites=[
 {date:'2026-11-08',title:'最初の依頼：分子XYZライブラリと分子エディタ',detail:'「サイト1＝ライブラリ、サイト2＝エディタ」の構成を提案。Three.jsによる3D表示、XYZ原文の保持、IndexedDB保存、Web Worker、BroadcastChannel、CPK配色、結合推定と日本語UIを要件にした。',items:['大量の分子データ（QM9全体、最大約13万件）を扱うため、非同期登録・遅延読み込み・仮想スクロールを要求','複数ファイル・フォルダーのドラッグ＆ドロップ、一覧のタイル表示、選択、ZIPと連結XYZの書き出し','コメント行・余分な列・フッターを含めたXYZ原文の保持'],source:'当時の最初の開発依頼'},
 {date:'2026-11-08',title:'ローカルHTML案からGPT Sitesへ',detail:'ローカルサーバ上で動くHTML/JSという当初の方針から、ChatGPT Sitesで開いて動かすWebアプリへ方針変更。分子の選択・編集・保存を二画面で扱う方向に進んだ。',items:['最初の公開サイトは「分子 XYZ スタジオ」','分子ライブラリから新しいタブでエディタを開く構成'],source:'開発依頼とSitesへの変更指示'},
 {date:'2026-11-08',title:'初期の3Dエディタを研究向けに拡張',detail:'分子の部分選択、特別点、モイエティ交換、構造の合理化・最適化操作などを要求。単なるファイル閲覧サイトから研究作業用エディタへ拡張した。',items:['選択した分子だけを最適化','最適化後は通常は重心を一致、特別点があれば特別点を合わせ、向きを維持して再配置','よく使う水分子を一覧の先頭に固定'],source:'当時のエディタ改善依頼'},
 {date:'2026-11-08',title:'ライブラリ操作：削除・範囲選択・並び順',detail:'ファイル管理を通常のエクスプローラーに近づける改訂。',items:['「全選択」「全解除」の横に「削除」を追加','ドラッグ矩形が少しでも触れたファイルを複数選択','表示名順をデフォルトにする要望','削除のキーボードショートカットを検討（後に統一）'],source:'当時の一覧UI改善依頼'},
 {date:'2026-11-08〜11-09',title:'xTB構造最適化：GFN2とGFN1',detail:'エディタから予備最適化を実行する機能を強化。金属クラスター・高電荷イオン・多重度を含む困難な系を念頭に置いていた。',items:['GFN2-xTBに加え、GFN1-xTBでの構造最適化ボタンを要求','SCF反復回数、収束失敗、計算ログの確認ができるようにする要望','初期の反復上限を150から30へ変更する案','GFN0-xTBやPM7の採用可能性も検討'],source:'当時の最適化関連の会話'},
 {date:'2026-11-08〜11-12',title:'ポリ酸・無機クラスターの利用から細部の改良へ',detail:'Keggin、Lindqvist、金属置換クラスターなどの構造作成・編集を想定した改訂が続いた。',items:['原子番号の一括表示・非表示','高スピン・高電荷での失敗やerr_linesearchの可視化','選択対象の重心・特別点を基準とした編集','構造や最適化ログを後から検証できるようにする要望'],source:'研究用途での利用と改修依頼'},
 {date:'2026-11-09〜11-12',title:'分子ファイル形式と複数フレーム表示を拡張',detail:'XYZ単体の編集を越え、SDFや複数構造入りXYZ、構造変化・反応経路の確認へ広げた。',items:['SDFをXYZへ変換して取り込む仕様（余分な属性を安全に処理）','複数分子ブロックの登録範囲選択','スライドショー画面で次・前・取り込み・一括取り込み・ダウンロード','エネルギープロファイル表示'],source:'ファイル形式・スライドショー改訂依頼'},
 {date:'2026-11-09〜11-12',title:'日常の操作感を詰める',detail:'研究作業中に不便になっていた操作を細かく修正する要望。',items:['黒ベースのダークテーマ','1分子追加ボタンと操作リストの重なりを改善','コメント表示の2段目を削除','Ctrl+Shift+Backspaceで削除操作を統一','並び替えの追加：追加日時順・逆名前順・内部ID順','選択したファイルへのタグ付与・削除、上書き保存ボタン'],source:'当時の操作性改善依頼'},
 {date:'2026-11-12',title:'計算記録とColabReactionを連携する構想',detail:'計算結果のZIPを受け取り、構造・エネルギー・条件の履歴を同じWebアプリで扱う方向へ。',items:['START/FINAL画像、Energy.png、config.txtの生成・保存','計算点数、電荷、スピン多重度、結果日時の一覧化','計算記録モードとライブラリ表示の切り替え','ORCA計算結果の可視化・保存との将来的な統合'],source:'当時の計算記録モードの改修依頼'},
 {date:'2026-11-12',title:'GPT Sitesの管理制約から独立運用へ',detail:'Sitesで作った成果物を外部で維持できるようにするため、公開サイトのコード・資産の回収や、GitHub・Firebase・Cloudflareへの移行を検討。',items:['公開URLと開発・管理環境を切り離す必要が生じた','独立したソース管理と公開フローの整備へ方針転換','以後の改訂はGitHubコミットとして追跡可能な範囲が増加'],source:'Sitesの利用条件と移行検討の会話'},
 {date:'2026-11-12〜11-13',title:'GitHubへの移行・Google Driveを正本に',detail:'Firebaseでのサイト公開、Cloudflare Worker経由のGoogle Drive接続、バージョン管理を整備。いったん試したバックアップ実装を戻し、Drive正本のデータストアへ再設計した。',items:['GitHub Actionsから手動で公開する仕組み','GoogleアカウントごとのDrive接続','分子・反応ライブラリをDriveで維持する設計','新しい「Mol Bench」ホームページの導入'],source:'GitHubコミット（下記）'},
 {date:'2026-11-14',title:'安全なデータ交換と計算記録一覧の高速化',detail:'電荷・多重度の保持、構造保存前の整合性確認、Colab記録のメタデータキャッシュなどを改良。',items:['電荷・スピン多重度をアーカイブとColab間で保持','反応の整合性確認と状態の同期','Colab記録ごとの大量通信を減らすDrive要約インデックス','旧データ形式やDriveメタデータ制限への対応'],source:'GitHubコミット（下記）'},
 {date:'2026-11-16',title:'高速ローカル保存・反応管理・計算ビューアを大幅拡張',detail:'IndexedDBによる高速ローカルモード、コピー＆ペースト、タグ・分類の引き継ぎ、振動アニメーション、ORCAギャラリーなどを追加。',items:['データ全体の移行を検証したうえで高速ローカル保存へ切り替えるモード','分子と反応のメタデータを保った複製・保存','反応経路・振動表示の24/48fps対応と画面ちらつき低減','エネルギープロファイルの0基準目盛りと過去画像の再生成'],source:'GitHubコミット（下記）'},
 {date:'2026-11-16',title:'Drive同期・バックアップと30日キャッシュ',detail:'ローカル高速保存モードのDriveバックアップ、競合時の確認・拒否、ColabReactionのXYZキャッシュを実装。',items:['同期差分の判定と競合の保留、削除時の確認','DMF_final.xyz・DMF_energy.csv・振動XYZを閲覧時にキャッシュ','最終アクセスから30日を超えるキャッシュを整理','構文チェック済み。同期処理の実機での安全性検証は未完了'],source:'GitHubコミット（下記）'}
];
function el(tag,cls,content){const node=document.createElement(tag);if(cls)node.className=cls;if(content!==undefined)node.textContent=content;return node;}
const siteRoot=document.getElementById('siteHistory');
for(const s of sites){
 const article=el('article','story'),time=el('time','',s.date),body=el('div');
 body.append(el('h3','',s.title),el('p','',s.detail));
 const list=el('ul','facts');for(const item of s.items)list.append(el('li','',item));
 body.append(list,el('span','source',s.source));article.append(time,body);siteRoot.append(article);
}
const commits=(window.MOL_BENCH_HISTORY_COMMITS||[]).slice();
const dates=[...new Set(commits.map(c=>c.date))].sort();
const day=document.getElementById('historyDay'),search=document.getElementById('historySearch'),root=document.getElementById('commitHistory'),count=document.getElementById('historyCount');
for(const date of dates)day.append(new Option(date,date));
function render(){
 const q=search.value.trim().toLocaleLowerCase('ja-JP');
 const visible=commits.filter(c=>(!day.value||c.date===day.value)&&(!q||(c.title+' '+c.sha+' '+c.date).toLocaleLowerCase('ja-JP').includes(q)));
 root.replaceChildren();count.textContent='表示 '+visible.length+' / '+commits.length+' 件（収録済みGitHubコミット）';
 let previous='';
 for(const c of visible){
  if(c.date!==previous){root.append(el('h3','day',c.date));previous=c.date;}
  const row=el('article','entry'),id=el('code','',c.sha),content=el('div');
  const a=el('a','',c.title);a.href=c.url;a.target='_blank';a.rel='noopener noreferrer';
  content.append(a,el('small','',c.sha));row.append(id,content);root.append(row);
 }
 if(!visible.length)root.append(el('p','missing','一致する改訂は見つかりませんでした。'));
}
day.addEventListener('change',render);
search.addEventListener('input',render);
document.getElementById('resetHistory').addEventListener('click',()=>{day.value='';search.value='';render();});
render();
