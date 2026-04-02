#!/usr/bin/env bash
# Copies ../build/web (Flutter) into public/ so / serves the customer app on the same deploy.
# On Vercel/CI without Flutter on PATH, installs a stable Flutter SDK under /tmp (cached path).
set -euo pipefail

ADMIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$(cd "$ADMIN_DIR/.." && pwd)"

install_flutter_ci() {
  # Vercel sets VERCEL=1 and/or VERCEL_ENV; GitHub Actions sets CI=true
  if [[ "${VERCEL:-}" != "1" && -z "${VERCEL_ENV:-}" && "${CI:-}" != "true" ]]; then
    return 1
  fi
  echo "CI/Vercel: installing Flutter stable to /tmp/flutter-sdk ..."
  export FLUTTER_ROOT="${FLUTTER_ROOT:-/tmp/flutter-sdk}"
  if [[ ! -x "${FLUTTER_ROOT}/bin/flutter" ]]; then
    rm -rf "${FLUTTER_ROOT}"
    git clone --depth 1 --branch stable https://github.com/flutter/flutter.git "${FLUTTER_ROOT}"
  fi
  export PATH="${FLUTTER_ROOT}/bin:${PATH}"
  flutter precache --web
  flutter config --enable-web --no-analytics
}

if [[ ! -f "${APP_DIR}/build/web/index.html" ]]; then
  if command -v flutter >/dev/null 2>&1; then
    echo "Building Flutter web in ${APP_DIR}..."
    (cd "${APP_DIR}" && flutter pub get && flutter build web --release)
  elif install_flutter_ci; then
    echo "Building Flutter web in ${APP_DIR}..."
    (cd "${APP_DIR}" && flutter pub get && flutter build web --release)
  else
    echo "Error: No Flutter web bundle at ${APP_DIR}/build/web/index.html." >&2
    echo "Install Flutter locally and run: cd ${APP_DIR} && flutter build web" >&2
    echo "Or deploy from Vercel/CI where this script installs Flutter automatically." >&2
    exit 1
  fi
fi

echo "Copying Flutter web bundle into ${ADMIN_DIR}/public/ ..."
cp -R "${APP_DIR}/build/web/." "${ADMIN_DIR}/public/"
