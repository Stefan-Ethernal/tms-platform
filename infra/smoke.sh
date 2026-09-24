#!/usr/bin/env bash
# Smoke test for the compose stack. Usage: infra/smoke.sh [--full]
# Default profile: postgres, mailpit, migrate. --full: also api-admin, api-driver, caddy.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# infra/.env supplies defaults only: variables already set (alternate ports, COMPOSE_PROJECT_NAME)
# win, the precedence docker compose itself applies. Sourcing the file would override them.
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    if [ -z "${!key+set}" ]; then export "$key=$value"; fi
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
fi

compose() { docker compose -f docker-compose.yml "$@"; }
fail() { echo "FAIL $*" >&2; exit 1; }
sql() { compose exec -T postgres psql -U tms -d tms -Atc "$1"; }

wait_http() { # name url
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$2"; then echo "ok   $1 reachable ($2)"; return 0; fi
    sleep 2
  done
  fail "$1 not reachable at $2"
}

# 1. migrate is a one-shot service: it must exit 0.
for _ in $(seq 1 60); do
  cid=$(compose ps -aq migrate)
  state=$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$cid" 2>/dev/null || echo missing)
  case "$state" in
    exited:0) echo "ok   migrate exited 0"; break ;;
    exited:*) compose logs migrate; fail "migrate $state" ;;
  esac
  sleep 2
done
[ "$state" = "exited:0" ] || fail "migrate did not finish (state $state)"

# 2. migrate deployed, synced and seeded (D12, deviation 5); a second run changes nothing.
# The catalogue size comes from the image: exactly the codes it synced, no host build needed.
catalogue=$(compose run --rm --no-deps -T migrate node -e \
  "process.stdout.write(String(require('@tms/contracts').PERMISSIONS.length))") \
  || fail "could not read the permission catalogue from the migrate image"
permissions=$(sql 'SELECT count(*) FROM "Permission" WHERE "isDeprecated" = false')
roles=$(sql "SELECT count(*) FROM \"Role\" WHERE \"key\" IN ('admin', 'operator', 'driver')")
admins=$(sql "SELECT count(*) FROM \"User\" u JOIN \"Role\" r ON r.id = u.\"roleId\" WHERE r.\"key\" = 'admin'")
[ "$permissions" = "$catalogue" ] || fail "migrate: $permissions active permissions, the catalogue has $catalogue"
[ "$roles" = 3 ] || fail "migrate: $roles of the 3 system roles exist"
[ "$admins" -ge 1 ] || fail "migrate: no administrator (BOOTSTRAP_ADMIN_EMAIL unset on an empty database?)"
echo "ok   migrate seeded: $permissions active permissions (= catalogue), 3 system roles, $admins admin(s)"

snapshot() {
  sql "SELECT concat_ws(' ', (SELECT count(*) FROM \"Permission\"), (SELECT max(\"syncedAt\") FROM \"Permission\"),
    (SELECT count(*) FROM \"RolePermission\"), (SELECT count(*) FROM \"Role\"), (SELECT count(*) FROM \"User\"),
    (SELECT count(*) FROM \"Product\"), (SELECT count(*) FROM \"LoadingPoint\"))"
}
before=$(snapshot)
rerun=$(compose run --rm -T migrate 2>&1) || { echo "$rerun" >&2; fail "second migrate run failed"; }
grep -q '"rolesCreated":\[\]' <<<"$rerun" || fail "second migrate run created roles: $rerun"
grep -q '"bootstrapAdmin":"exists"' <<<"$rerun" || fail "second migrate run did not find the admin: $rerun"
after=$(snapshot)
[ "$after" = "$before" ] || fail "second migrate run changed the database: [$before] -> [$after]"
echo "ok   migrate is idempotent (second run created nothing; row counts and syncedAt unchanged)"

# 3. mailpit API answers.
wait_http mailpit "http://localhost:${MAILPIT_UI_PORT:-8025}/api/v1/info"

if [ "${1:-}" = "--full" ]; then
  check_origin() { # name port title
    wait_http "$1" "http://localhost:$2/"
    curl -fsS "http://localhost:$2/" | grep -q "<title>$3</title>" || fail "$1: title '$3' not served"
    echo "ok   $1 serves the SPA"
    # Caddy starts before Nest has bound its port (depends_on = started), so retry until the API answers.
    code=""
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$2/api/does-not-exist")
      [ "$code" = "404" ] && break
      sleep 2
    done
    [ "$code" = "404" ] || fail "$1: /api answered $code, expected 404 from the API"
    body=$(curl -sS "http://localhost:$2/api/does-not-exist")
    echo "$body" | grep -q '"statusCode":404' || fail "$1: /api did not reach the API (got: $body)"
    echo "ok   $1 forwards /api to the API (JSON 404, not index.html)"
    # Regression: Caddy's path matcher `/api/*` alone does not match the bare `/api`
    # path (no trailing slash), so it fell through to the SPA handler and served
    # index.html instead of the API's 404. Guard both the status and the content type.
    code=""
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$2/api")
      [ "$code" = "404" ] && break
      sleep 2
    done
    [ "$code" = "404" ] || fail "$1: bare /api answered $code, expected 404 from the API"
    headers=$(curl -sS -D- -o /dev/null "http://localhost:$2/api")
    echo "$headers" | grep -qi '^content-type: application/json' \
      || fail "$1: bare /api did not return JSON (got headers: $headers)"
    echo "ok   $1 forwards bare /api to the API (JSON 404, not index.html)"
  }
  check_origin web-admin "${CADDY_ADMIN_PORT:-8080}" "TMS Admin"
  check_origin web-driver "${CADDY_KIOSK_PORT:-8081}" "TMS Kiosk"
fi

echo "smoke: all checks passed"
