#!/usr/bin/env bash
#
# Start a local tt-rss demo stack (PostgreSQL + PHP + seeded data).
#
# This is a development helper for trying the Vue app. It is idempotent:
# it starts PostgreSQL, creates the demo database if needed, applies the
# schema, reseeds the demo data, and serves the app on PHP_PORT.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PHP_PORT="${PHP_PORT:-12000}"
PUBLIC_URL="${TTRSS_SELF_URL_PATH:-https://work-1-zglbmtdjglizlbqi.prod-runtime.all-hands.dev}"
DB_HOST="${TTRSS_DB_HOST:-localhost}"
DB_PORT="${TTRSS_DB_PORT:-5432}"
DB_NAME="${TTRSS_DB_NAME:-ttrss_test}"
DB_USER="${TTRSS_DB_USER:-ttrss_test}"
DB_PASS="${TTRSS_DB_PASS:-ttrss_test}"
SEED_DEMO="${SEED_DEMO:-1}"

if ! command -v php >/dev/null 2>&1; then
  echo "run-demo-stack: php is required (install php-cli and the pgsql extension)" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "run-demo-stack: psql is required (install postgresql-client)" >&2
  exit 1
fi

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
  echo "run-demo-stack: starting PostgreSQL"
  sudo pg_ctlcluster 17 main start
fi

if ! sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
fi

if ! sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
fi

php ./update.php --update-schema=force-yes

if [[ "$SEED_DEMO" == "1" ]]; then
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -f tests_integration/seed.sql >/dev/null

  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
    "UPDATE ttrss_feeds SET last_error = '', last_updated = NOW();" >/dev/null

  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<'SQL' >/dev/null
DELETE FROM ttrss_user_prefs2 WHERE owner_uid=1 AND pref_name IN (
  'COMBINED_DISPLAY_MODE','CDM_AUTO_CATCHUP','CDM_EXPANDED','CDM_ENABLE_GRID',
  'WIDESCREEN_MODE','VFEED_GROUP_BY_FEED','DEBUG_HEADLINE_IDS',
  'FRESH_ARTICLE_MAX_AGE','RECENTLY_READ_MAX_AGE','USER_CSS_THEME',
  'DEFAULT_SEARCH_LANGUAGE','CONFIRM_FEED_CATCHUP','_ENABLED_PLUGINS'
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
  (1,'USER_CSS_THEME','feedly/dist/feedly.css',NULL),
  (1,'DEFAULT_SEARCH_LANGUAGE','english',NULL),
  (1,'CONFIRM_FEED_CATCHUP','0',NULL),
  (1,'_ENABLED_PLUGINS','auth_internal,note',NULL);
SQL
fi

rm -rf cache/login-throttle

if [[ ! -f dist/.vite/manifest.json ]]; then
  corepack pnpm@9 run build
fi

pkill -f "php -S 0.0.0.0:${PHP_PORT}" 2>/dev/null || true

TTRSS_SELF_URL_PATH="$PUBLIC_URL" php -S "0.0.0.0:${PHP_PORT}" -t . \
  >/tmp/php-server.log 2>&1 &
echo $! >/tmp/php-server.pid

sleep 1
curl -fsS -o /dev/null "http://127.0.0.1:${PHP_PORT}/index.php"
echo "run-demo-stack: serving on ${PUBLIC_URL} (local http://127.0.0.1:${PHP_PORT})"
echo "run-demo-stack: demo login admin / password"
