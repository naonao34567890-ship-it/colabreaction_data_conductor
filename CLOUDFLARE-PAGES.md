# Cloudflare Pages への公開

このリポジトリには Pages 用の設定を追加済みです。公開はまだ行っていません。

1. https://dash.cloudflare.com/ にログインします。
2. Workers & Pages → Create application → Pages → Import an existing Git repository を開きます。
3. GitHub を接続し、`naonao34567890-ship-it/colabreaction_data_conductor` を選びます。
4. Production branch は `main`、Framework preset は `None` にします。
5. Build command は空欄、Build output directory は `dist`、Root directory はリポジトリのルートにします。
6. Save and Deploy を押します。作成後は main への更新が自動公開されます。

Pages のインポート画面を使用してください。Workers のデプロイ画面とは設定が異なります。
`wrangler.jsonc` も同じ出力先を指定しています。npm install やビルドは不要です。
`functions/` は Pages がサーバー側で処理するため、削除しないでください。

## 移行範囲

- 分子ライブラリ、XYZ/SDF取り込み、分子表示・編集、ブラウザ内計算のファイルをそのまま配置します。
- 実計算とブラウザ操作の公開後検証は別途必要です。
- ブラウザ内の保存データ・計算ログは元URLと別領域になります。必要なデータは元サイトから書き出してください。
- Google Driveの継続接続は未移行です。元WorkerはSitesが付与する認証ヘッダー・R2・暗号鍵・Google OAuth設定に依存します。Pagesでそのまま公開すると認証が成立しません。
- PagesのDrive APIは移行未完了を返します。元サイトの認証処理をそのまま転用しません。Google OAuthの移転先URL登録、信頼できるログイン検証、R2と秘密情報の設定が必要です。
- 元ソースと87コミットの履歴は維持しています。元のSites設定とWorkerも削除していません。

## 公開後の確認

トップ画面、XYZ/SDF取り込み、分子編集、GFN1/GFN2の小分子計算、ログ保存を確認してください。
WASMファイルの取得が成功することも確認してください。
