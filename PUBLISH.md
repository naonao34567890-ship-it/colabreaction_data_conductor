# 公開スイッチ（初回設定後はGitHubで1回実行）

公開対象はFirebaseの `mol-bench.web.app` と接続サーバーの `mol-bench-drive`。コードをGitHubへ保存しただけでは、このワークフローは公開を開始しない。**Actions → Publish Mol Bench → Run workflow** を押したときだけ実行する。

先に案内したCloudflareのGit repository / Builds連携は、この方式では不要。既にWorkerの自動ビルドを接続している場合は、その自動ビルドを無効にしてから使う。旧Cloudflare Pagesの自動公開は別設定なので、旧サイトを使わない場合はそちらも停止できる。

## 初回だけの設定

### 1. Googleの公開権限を作る

FirebaseのCloud Shellで、今の作業フォルダーから次を実行する。

```bash
cd ~/mol-bench-site
git fetch origin
git checkout origin/main -- scripts/setup-deployment-google.sh
bash scripts/setup-deployment-google.sh
```

Googleの承認画面が出たら承認する。このスクリプトは `mol-bench` プロジェクトにHosting公開専用のサービスアカウントとGitHubの一時認証を設定する。JSON秘密鍵やFirebaseトークンは発行しない。

対象のGitHubリポジトリID・所有者ID、mainブランチ、この公開ワークフロー、手動起動だけをGoogle側で許可する。既存の他アカウントの権限を削除せず、専用アカウントの権限を追加する。

最後に表示される次の2つを控える（どちらも秘密情報ではない）。

- `GCP_WIF_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

### 2. GitHubに3つの変数を登録する

リポジトリ → **Settings → Secrets and variables → Actions → Variables → New repository variable**。

| 名前 | 値 |
| --- | --- |
| `GCP_WIF_PROVIDER` | 上のスクリプトに表示された値 |
| `GCP_SERVICE_ACCOUNT` | 上のスクリプトに表示された値 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflareでmol-bench-driveを所有するアカウントのAccount ID |

### 3. Cloudflareの公開トークンを登録する

[CloudflareのAPIトークン](https://dash.cloudflare.com/profile/api-tokens)で **Edit Cloudflare Workers** テンプレートから、対象アカウントへのトークンを作る。Workersの公開・KV bindingの参照・Durable Objectの設定に使う。

GitHubの **Settings → Secrets and variables → Actions → Secrets → New repository secret** に登録する。

- Name: `CLOUDFLARE_API_TOKEN`
- Secret: 作ったトークン

トークンはCloudflareからGitHubへ直接コピーする。チャット・リポジトリのファイルには貼らない。既存WorkerのGoogleシークレットと暗号化キーは変更しない。

## 普段の公開

1. このチャットでコードを修正し、GitHubへの保存を終える。
2. GitHubの **Actions → Publish Mol Bench → Run workflow** を開く。
3. Branchは **main**、targetは **both**、publishはチェックしたままにする。
4. **Run workflow** を押す。

テスト → Worker公開 → backend確認 → Firebase公開 → frontend確認の順。両方とも、ボタンを押した時点の同じコミットを使う。後からmainに入った変更を勝手に混ぜない。

Workerだけならtargetを `worker`、画面だけなら `hosting` にできる。通常は `both`。publishのチェックを外すとテストだけ実行し、公開は一切行わない。

公開用の3変数・1Secretがない場合は、どちらのサービスも変更する前に停止する。テストやWorkerの公開に失敗したらFirebaseの公開には進まない。2つのサービスをまたぐ自動ロールバックは行わず、途中失敗はジョブの結果で確認する。

Workerの健康確認と、今回のソースのコミット番号を確認する。Firebaseには公開時に `deployment.json` を作り、同じコミット番号が見えることを確認する。初回の実Drive移行と操作確認は [DRIVE-STORAGE.md](DRIVE-STORAGE.md) を参照。

## このチャットからの実行

GitHubへのワークフロー実行権限がある場合は、作業完了後に次でも同じスイッチを実行できる。

```bash
gh workflow run deploy.yml --ref main -f target=both -f publish=true
```

検証だけなら `-f publish=false`。自動のpush起動や定期起動は設定していない。
