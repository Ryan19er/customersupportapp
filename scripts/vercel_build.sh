#!/usr/bin/env bash
set -euo pipefail

./.vercel/flutter/bin/flutter --disable-analytics build web --release

# Vercel sometimes reads project-level Output Directory as "web".
# Mirror Flutter output so either "build/web" or "web" works.
rm -rf web
mkdir -p web
cp -R build/web/. web/

