#!/usr/bin/env bash
set -euo pipefail

./.vercel/flutter/bin/flutter --disable-analytics build web --release

