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
  check_origin() { # name port title service
    wait_http "$1" "http://localhost:$2/"
    curl -fsS "http://localhost:$2/" | grep -q "<title>$3</title>" || fail "$1: title '$3' not served"
    echo "ok   $1 serves the SPA"
    # Caddy waits for healthy APIs; the retries only absorb Caddy's own start-up.
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
    # D5 + routing identity (journal I7-1): exactly {"status":"ok","service":"<api>"} with 200,
    # never cached, so the kiosk origin provably reaches api-driver and the back office api-admin.
    health=$(curl -sS -w ' %{http_code}' "http://localhost:$2/api/health")
    expected="{\"status\":\"ok\",\"service\":\"$4\"} 200"
    [ "$health" = "$expected" ] || fail "$1: /api/health answered '$health', expected '$expected'"
    headers=$(curl -sS -D- -o /dev/null "http://localhost:$2/api/health")
    echo "$headers" | grep -qi '^cache-control: no-store' || fail "$1: /api/health lacks Cache-Control: no-store"
    echo "ok   $1 /api/health answers 200 from $4 with no-store"
  }
  # D12 ordering proof (journal M6-6): both APIs started only after migrate finished with exit 0.
  # Docker's timestamps have a variable-length fraction, so they are compared as epoch nanoseconds.
  check_migrate_ordering() {
    local migrate finished api id started
    migrate=$(compose ps -aq migrate)
    [ "$(docker inspect -f '{{.State.ExitCode}}' "$migrate")" = "0" ] || fail "migrate did not exit 0"
    finished=$(docker inspect -f '{{.State.FinishedAt}}' "$migrate")
    for api in api-admin api-driver; do
      id=$(compose ps -q "$api")
      [ -n "$id" ] || fail "$api is not running"
      started=$(docker inspect -f '{{.State.StartedAt}}' "$id")
      [ "$(date -d "$started" +%s%N)" -gt "$(date -d "$finished" +%s%N)" ] \
        || fail "$api started at $started, before migrate finished at $finished"
    done
    echo "ok   api-admin and api-driver started after migrate finished ($finished)"
  }
  check_migrate_ordering
  check_origin web-admin "${CADDY_ADMIN_PORT:-8080}" "TMS Admin" api-admin
  check_origin web-driver "${CADDY_KIOSK_PORT:-8081}" "TMS Kiosk" api-driver

  # D14: each API writes JSON log files into the shared `logs` volume, one directory per app.
  check_log_file() { # service
    local file=""
    for _ in $(seq 1 10); do
      file=$(compose exec -T "$1" sh -c "ls /var/log/tms/$1/*.log 2>/dev/null | head -1")
      [ -n "$file" ] && break
      sleep 1
    done
    [ -n "$file" ] || fail "$1: no log file under /var/log/tms/$1"
    echo "ok   $1 writes $file"
  }
  check_log_file api-admin
  check_log_file api-driver
fi

echo "smoke: all checks passed"
