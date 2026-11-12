# Firebase版のDrive継続接続

フロント: https://mol-bench.web.app
Worker: https://mol-bench-drive.naonao34567890.workers.dev

## Google設定

既存のWeb OAuthクライアントに、元URLを残して以下を追加する。

- Authorized JavaScript origins: `https://mol-bench.web.app`
- Authorized redirect URIs: `https://mol-bench-drive.naonao34567890.workers.dev/callback`

接続には `drive.file` と `openid email` を使う。Google Auth PlatformのAudienceがTestingの場合、外部アプリのrefresh tokenは通常7日で失効するため、継続運用には公開ステータスも確認する。アカウントの許可取り消し等でも再接続が必要。

## Cloudflare設定

1. Workers & Pages → mol-bench-drive → Edit code で worker.mjs の内容を貼り付けてDeploy。
2. Workers KVでnamespace `mol-bench-drive` を作成。
3. WorkerのBindingsでKV namespace bindingを追加。変数名は `DRIVE_KV`、namespaceは上記。
4. Settings → Variables and Secrets に以下を設定してDeploy。

| 名前 | 種類 | 値 |
| --- | --- | --- |
| `GOOGLE_CLIENT_SECRET` | Secret | 既存Google OAuthクライアントのシークレット |
| `DRIVE_STORAGE_KEY` | Secret | 暗号化用のランダム32バイトをBase64にした文字列 |
| `ALLOWED_EMAIL` | Variable | Drive接続を許可する本人のGoogleメールアドレス（1件） |

暗号鍵はCloud Shellで `openssl rand -base64 32` を実行して生成する。鍵やシークレットはチャット・GitHubに貼らずCloudflareに入力する。鍵を変更すると保存済み接続は読めなくなる。

WorkerのルートURLが `configured: true` を返すことを確認する。これは変数の存在確認のみで、OAuth成功の検証ではない。

## Firebaseの更新

Cloud Shellで以前cloneしたフォルダーを使う（firebase.jsonは以前作成したものを維持）。

```bash
cd ~/mol-bench-site
git fetch origin
git checkout origin/main -- dist standalone-drive
npx --yes firebase-tools deploy --only hosting --project mol-bench
```

Colab計算記録ページの「Google Driveに接続」からGoogleの許可を行う。同じブラウザで別ライブラリに移動して戻り、接続が復元されることを確認する。

## 保存と制限

- Googleの更新トークンはAES-GCMで暗号化してKVへ保存する。保存キーにはブラウザ用セッションのSHA-256を使う。
- ブラウザには接続用のランダムセッションだけを保存し、Googleの更新トークンやクライアントシークレットは送らない。
- セッション有効期限は接続から30日。ブラウザの保存データ削除やGoogle側の失効でも再許可が必要。
- ページ再訪時とDriveの401応答時にサーバーでGoogleトークンを更新する。
- Googleで確認済みのメールがALLOWED_EMAILと一致するアカウントだけを許可する。
- OAuthのstateとPKCEに加え、ブラウザに保存したflow値とコールバックを照合する。
- サードパーティCookieは使わない。
- バックエンドのlogout APIはセッションを削除する。Google側のアクセス許可取り消しも利用できる。
- KV/Workersの無料枠には上限がある。Firebase側にFunctionsや有料プランは不要。
- Googleとの実接続は公開設定後に検証する。現時点のテストはモックを使ったOAuth・更新・アクセス制限の検証。
