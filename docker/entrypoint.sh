#!/bin/sh
set -e

# Config::CACHE_DIR and LOCK_DIRECTORY default to paths relative to the cwd.
cd /var/www/html

mkdir -p cache/images cache/upload cache/export feed-icons lock
chown -R www-data:www-data cache feed-icons lock

if [ "${TTRSS_UPDATE_SCHEMA:-0}" = "1" ]; then
    su-exec www-data:www-data /usr/local/bin/php update.php --update-schema=force-yes
fi

exec /usr/bin/supervisord -c /etc/supervisord.conf
