#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/client dist/server
mkdir -p dist/client dist/server
find dist -mindepth 1 -maxdepth 1 ! -name server ! -name client -exec cp -r {} dist/client/ \;
cp worker/index.mjs dist/server/index.js
