#!/usr/bin/env bash
# Run once in the user's authenticated Google Cloud Shell. No secret key is created.
set -euo pipefail
PROJECT_ID=mol-bench
POOL_ID=mol-bench-github
PROVIDER_ID=github
SERVICE_ACCOUNT_ID=mol-bench-deployer
REPO=naonao34567890-ship-it/colabreaction_data_conductor

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
REPOSITORY_INFO=$(curl -fsS "https://api.github.com/repos/$REPO")
REPO_ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<< "$REPOSITORY_INFO")
OWNER_ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["owner"]["id"])' <<< "$REPOSITORY_INFO")
REPO=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["full_name"])' <<< "$REPOSITORY_INFO")
ACCOUNT="$SERVICE_ACCOUNT_ID@$PROJECT_ID.iam.gserviceaccount.com"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com --project "$PROJECT_ID"
if ! gcloud iam service-accounts describe "$ACCOUNT" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_ID" --display-name='Mol Bench Hosting deployment' --project "$PROJECT_ID"
fi
for role in roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$ACCOUNT" --role="$role" --condition=None --quiet >/dev/null
done
if ! gcloud iam workload-identity-pools describe "$POOL_ID" --location=global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" --location=global --display-name='Mol Bench GitHub deployment' --project "$PROJECT_ID"
fi
MAPPING='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id'
CONDITION="assertion.repository_id == '$REPO_ID' && assertion.repository_owner_id == '$OWNER_ID' && assertion.ref == 'refs/heads/main' && assertion.event_name == 'workflow_dispatch' && assertion.workflow_ref == '$REPO/.github/workflows/deploy.yml@refs/heads/main'"
if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --workload-identity-pool="$POOL_ID" --location=global --project "$PROJECT_ID" >/dev/null 2>&1; then
  ISSUER=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --workload-identity-pool="$POOL_ID" --location=global --project "$PROJECT_ID" --format='value(oidc.issuerUri)')
  test "$ISSUER" = https://token.actions.githubusercontent.com || { echo 'Existing provider belongs to a different issuer. No provider was changed.'; exit 1; }
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" --workload-identity-pool="$POOL_ID" --location=global --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" --project "$PROJECT_ID"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" --workload-identity-pool="$POOL_ID" --location=global --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" --project "$PROJECT_ID"
fi
gcloud iam service-accounts add-iam-policy-binding "$ACCOUNT" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository_id/$REPO_ID" --project "$PROJECT_ID" --quiet >/dev/null
printf '\nGitHub repository variables (not secrets):\n'
printf 'GCP_WIF_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\n' "$PROJECT_NUMBER" "$POOL_ID" "$PROVIDER_ID"
printf 'GCP_SERVICE_ACCOUNT=%s\n' "$ACCOUNT"
