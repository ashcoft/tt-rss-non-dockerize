#!/usr/bin/env bash
#
# Start a local tt-rss demo stack with seeded data.
#
# Two runtimes:
#
#   ./scripts/run-demo-stack.sh            native: PostgreSQL + `php -S`
#   ./scripts/run-demo-stack.sh --docker   containers: the published image + PostgreSQL
#
# Both are idempotent: the schema is migrated, the demo data is reseeded and the
# demo preferences (combined mode, Feedly theme) are applied.
#
# Environment:
#
#   PHP_PORT             port to serve on (default 12000)
#   TTRSS_SELF_URL_PATH  public URL used for cookies and the CSRF/scheme check
#                        (default http://localhost:$PHP_PORT)
#   TTRSS_IMAGE          image for --docker
#                        (default ghcr.io/ashcoft/tt-rss-non-dockerize:vite-dev)
#   SEED_DEMO=0          skip the demo seed
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PHP_PORT="${PHP_PORT:-12000}"
PUBLIC_URL="${TTRSS_SELF_URL_PATH:-http://localhost:${PHP_PORT}}"
DB_HOST="${TTRSS_DB_HOST:-localhost}"
DB_PORT="${TTRSS_DB_PORT:-5432}"
DB_NAME="${TTRSS_DB_NAME:-ttrss_test}"
DB_USER="${TTRSS_DB_USER:-ttrss_test}"
DB_PASS="${TTRSS_DB_PASS:-ttrss_test}"
SEED_DEMO="${SEED_DEMO:-1}"

TTRSS_IMAGE="${TTRSS_IMAGE:-ghcr.io/ashcoft/tt-rss-non-dockerize:vite-dev}"
NETWORK="ttrss-demo"
DB_CONTAINER="ttrss-demo-db"
APP_CONTAINER="ttrss-demo-app"

RUNTIME="native"
if [[ "${1:-}" == "--docker" ]]; then
  RUNTIME="docker"
fi

# Rootless setups (and CI sandboxes) often need sudo for the socket.
DOCKER="docker"
if ! docker info >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

say() {
  echo "run-demo-stack: $*"
}

wait_for() {
  local what="$1"
  shift
  for _ in $(seq 1 60); do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  say "timed out waiting for ${what}"
  return 1
}

# --- SQL helpers -----------------------------------------------------------
# The seed block is shared by both runtimes; only the client differs.

sql_stdin() {
  if [[ "$RUNTIME" == "docker" ]]; then
    $DOCKER exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q -v ON_ERROR_STOP=1
  else
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -v ON_ERROR_STOP=1
  fi
}

seed_demo() {
  sql_stdin < tests_integration/seed.sql >/dev/null

  # The seed ships fixed dates; make them recent so the Fresh view is not empty.
  sql_stdin <<'SQL'
UPDATE ttrss_entries SET updated = now(), date_entered = now(), date_updated = now();
UPDATE ttrss_feeds SET last_error = '', last_updated = NOW();
SQL

  sql_stdin <<'SQL'
DELETE FROM ttrss_user_prefs2 WHERE owner_uid=1 AND pref_name IN (
  'COMBINED_DISPLAY_MODE','CDM_AUTO_CATCHUP','CDM_EXPANDED','CDM_ENABLE_GRID',
  'WIDESCREEN_MODE','VFEED_GROUP_BY_FEED','DEBUG_HEADLINE_IDS',
  'FRESH_ARTICLE_MAX_AGE','RECENTLY_READ_MAX_AGE','USER_CSS_THEME',
  'DEFAULT_SEARCH_LANGUAGE','CONFIRM_FEED_CATCHUP','_ENABLED_PLUGINS',
  '_DEFAULT_VIEW_MODE'
);
INSERT INTO ttrss_user_prefs2 (owner_uid,pref_name,value,profile) VALUES
  (1,'COMBINED_DISPLAY_MODE','1',NULL),
  (1,'CDM_AUTO_CATCHUP','1',NULL),
  (1,'CDM_EXPANDED','1',NULL),
  (1,'CDM_ENABLE_GRID','0',NULL),
  (1,'WIDESCREEN_MODE','0',NULL),
  (1,'VFEED_GROUP_BY_FEED','0',NULL),
  (1,'DEBUG_HEADLINE_IDS','0',NULL),
  (1,'FRESH_ARTICLE_MAX_AGE','100000',NULL),
  (1,'RECENTLY_READ_MAX_AGE','100000',NULL),
  (1,'USER_CSS_THEME','feedly/dist/feedly-sepia_night.css',NULL),
  (1,'DEFAULT_SEARCH_LANGUAGE','english',NULL),
  (1,'CONFIRM_FEED_CATCHUP','0',NULL),
  (1,'_DEFAULT_VIEW_MODE','all_articles',NULL),
  (1,'_ENABLED_PLUGINS','auth_internal,note',NULL);
SQL
}

# --- Docker runtime --------------------------------------------------------

start_docker() {
  command -v docker >/dev/null 2>&1 || {
    say "docker is required for --docker"
    exit 1
  }

  $DOCKER network create "$NETWORK" >/dev/null 2>&1 || true

  if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    $DOCKER start "$DB_CONTAINER" >/dev/null
  else
    say "starting PostgreSQL"
    $DOCKER run -d --name "$DB_CONTAINER" --restart unless-stopped --network "$NETWORK" \
      -e POSTGRES_DB="$DB_NAME" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" \
      postgres:16-alpine >/dev/null
  fi

  wait_for "PostgreSQL" $DOCKER exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME"

  # Recreate the app so the image, environment and port always match this run.
  $DOCKER rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
  say "starting the app image ${TTRSS_IMAGE}"
  $DOCKER run -d --name "$APP_CONTAINER" --restart unless-stopped --network "$NETWORK" \
    -p "${PHP_PORT}:8080" \
    -e TTRSS_DB_HOST="$DB_CONTAINER" -e TTRSS_DB_NAME="$DB_NAME" \
    -e TTRSS_DB_USER="$DB_USER" -e TTRSS_DB_PASS="$DB_PASS" \
    -e TTRSS_SELF_URL_PATH="$PUBLIC_URL" -e TTRSS_UPDATE_SCHEMA=1 \
    "$TTRSS_IMAGE" >/dev/null

  wait_for "the app" $DOCKER exec "$APP_CONTAINER" \
    wget -qO- http://127.0.0.1:8080/public.php?op=healthcheck
}

# --- Native runtime --------------------------------------------------------

start_native() {
  command -v php >/dev/null 2>&1 || {
    say "php is required for the native runtime (or pass --docker)"
    exit 1
  }
  command -v psql >/dev/null 2>&1 || {
    say "psql is required for the native runtime (or pass --docker)"
    exit 1
  }

  if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
    say "starting PostgreSQL"
    sudo pg_ctlcluster 17 main start
  fi

  if ! sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  fi

  if ! sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  fi

  php ./update.php --update-schema=force-yes

  rm -rf cache/login-throttle

  if [[ ! -f dist/.vite/manifest.json ]]; then
    corepack pnpm@9 run build
  fi

  pkill -f "php -S 0.0.0.0:${PHP_PORT}" 2>/dev/null || true

  TTRSS_SELF_URL_PATH="$PUBLIC_URL" php -S "0.0.0.0:${PHP_PORT}" -t . \
    >/tmp/php-server.log 2>&1 &
  echo $! >/tmp/php-server.pid

  wait_for "the PHP server" curl -fsS -o /dev/null "http://127.0.0.1:${PHP_PORT}/index.php"
}

# --- Run -------------------------------------------------------------------

if [[ "$RUNTIME" == "docker" ]]; then
  start_docker
else
  start_native
fi

if [[ "$SEED_DEMO" == "1" ]]; then
  say "seeding demo data"
  seed_demo
fi

say "serving on ${PUBLIC_URL} (local http://127.0.0.1:${PHP_PORT})"
say "demo login admin / password"

if [[ "$RUNTIME" == "docker" ]]; then
  say "stop with: docker rm -f ${APP_CONTAINER} ${DB_CONTAINER}"
else
  say "stop with: kill $(cat /tmp/php-server.pid)"
fi
