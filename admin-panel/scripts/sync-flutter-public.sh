#!/usr/bin/env bash
# Copies Flutter build/web into admin-panel/public/ so / serves the customer app.
# Flutter root is found by walking up from admin-panel until pubspec.yaml is found.
# On Vercel/CI without Flutter on PATH, installs a stable Flutter SDK under /tmp.
set -euo pipefail

ADMIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Resolve directory that contains pubspec.yaml (Flutter app root)
APP_DIR="$ADMIN_DIR"
while [[ "$APP_DIR" != "/" ]]; do
  if [[ -f "${APP_DIR}/pubspec.yaml" ]]; then
    break
  fi
  APP_DIR="$(dirname "$APP_DIR")"
done
if [[ ! -f "${APP_DIR}/pubspec.yaml" ]]; then
  echo "Error: Could not find pubspec.yaml above ${ADMIN_DIR}." >&2
  echo "Deploy from the repo folder that contains both the Flutter app and admin-panel/ (see README)." >&2
  exit 1
fi

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
