# syntax=docker/dockerfile:1

# Vue bundle served by index.php/prefs.php (a production build is required).
FROM node:24-alpine AS assets

RUN npm install --global pnpm@9

WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm run build

# PHP dependencies (vendor/ is not committed).
FROM composer:2 AS vendor

WORKDIR /src

COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --no-progress --prefer-dist \
        --no-scripts --ignore-platform-reqs

FROM php:8.3-fpm-alpine

RUN apk add --no-cache nginx supervisor su-exec tzdata postgresql-client \
        freetype icu-libs libjpeg-turbo libpng libpq libzip \
    && apk add --no-cache --virtual .build-deps \
        $PHPIZE_DEPS freetype-dev icu-dev libjpeg-turbo-dev libpng-dev libzip-dev \
        postgresql-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" exif gd intl pcntl pdo_pgsql zip \
    && docker-php-ext-enable opcache \
    && apk del .build-deps \
    && rm -rf /var/cache/apk/*

WORKDIR /var/www/html

COPY --from=vendor /src/vendor ./vendor
COPY . .
COPY --from=assets /src/dist ./dist

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/zz-tt-rss.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/zz-tt-rss.ini
COPY docker/supervisord.conf /etc/supervisord.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint

RUN chmod 0755 /usr/local/bin/entrypoint \
    && mkdir -p cache/images cache/upload cache/export feed-icons lock \
    && chown -R www-data:www-data cache feed-icons lock

ENV TTRSS_PHP_EXECUTABLE=/usr/local/bin/php

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD wget -qO- http://127.0.0.1:8080/public.php?op=healthcheck >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint"]
