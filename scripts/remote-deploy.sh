#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${TARGET_BRANCH:?TARGET_BRANCH is required}"
APP_MODE="${APP_MODE:-dev}"
CONTAINER_NAME="yg1-ai-catalog-app-${APP_MODE}"

echo "[remote-deploy] branch=${TARGET_BRANCH} app_mode=${APP_MODE}"

git fetch origin "${TARGET_BRANCH}" --prune
git checkout -B "${TARGET_BRANCH}" "origin/${TARGET_BRANCH}"
git reset --hard "origin/${TARGET_BRANCH}"

sudo docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
sudo env APP_MODE="${APP_MODE}" docker compose up --build -d --force-recreate app

if ! sudo docker ps --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "[remote-deploy] expected container is not running: ${CONTAINER_NAME}" >&2
  exit 1
fi

sudo docker ps --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}|{{.Status}}'
