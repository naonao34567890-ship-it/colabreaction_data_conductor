#!/usr/bin/env bash
set -euo pipefail
if [[ "${RELEASE_USE_SYSTEM_BROWSER:-0}" != 1 ]]; then
  npm install --no-save --package-lock=false playwright@1.65.0
  npx playwright install --with-deps chromium
  export CHROMIUM_PATH="$(node -p "require('playwright').chromium.executablePath()")"
fi
node tests/test.cjs
shopt -s nullglob
for test_file in tests/*.test.mjs tests/*.test.cjs; do
  timeout 120s node "$test_file"
done
npx --yes wrangler@4.161.0 deploy --dry-run --config standalone-drive/wrangler.jsonc
