#!/usr/bin/env bash
set -euo pipefail

if [ ! -x .vercel/flutter/bin/flutter ]; then
  rm -rf .vercel/flutter
  git clone --depth 1 -b stable https://github.com/flutter/flutter.git .vercel/flutter
fi

./.vercel/flutter/bin/flutter --disable-analytics --version
./.vercel/flutter/bin/flutter pub get

