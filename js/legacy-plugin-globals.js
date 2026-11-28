/**
 * Legacy plugin globals for the Vue client.
 *
 * Plugin JS written for the Dojo client calls App.escapeHtml(), reads
 * Headlines.headlines[id], uses Notify/xhr.json, calls require([...], cb) and
 * builds dijit dialogs. The Vue app installs live implementations over these
 * placeholders (src/vue/utils/legacyPlugins.ts); what is here only has to keep
 * the plugin scripts from throwing before it mounts.
 */
(function () {
  'use strict';

  const scope = window;

  // Dojo's ready(): these scripts sit at the end of the body, so run at once.
  scope.require = function (deps, callback) {
    if (typeof callback !== 'function') return;

    try {
      callback(scope.dojo || {}, function (fn) {
        try {
          if (typeof fn === 'function') fn();
        } catch (err) {
          console.warn('plugin ready failed', err);
        }
      });
    } catch (err) {
      console.warn('plugin require failed', err);
    }
  };
  scope.dojo = scope.dojo || {};

  scope.App = scope.App || {};
  scope.App.hotkey_actions = scope.App.hotkey_actions || {};
  scope.App.global_unread = scope.App.global_unread || 0;
  scope.App.global_fresh = scope.App.global_fresh || 0;

  // Pure helpers are available before the app mounts; the rest are replaced by
  // the live implementations in src/vue/utils/legacyPlugins.ts.
  scope.App.escapeHtml = function (text) {
    return String(text === undefined || text === null ? '' : text).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  };

  scope.App.isCombinedMode = scope.App.isCombinedMode || function () { return false; };
  scope.App.getInitParam = scope.App.getInitParam || function () { return undefined; };
  scope.App.updateTitle = scope.App.updateTitle || function () {};

  scope.App.getPhArgs = scope.App.getPhArgs || function (plugin, method, params) {
    const args = { op: 'PluginHandler', plugin: plugin, method: method };

    Object.keys(params || {}).forEach(function (key) {
      args[key] = params[key];
    });

    return args;
  };
  scope.Headlines = scope.Headlines || { headlines: {}, click: function () { return false; } };
  scope.Feeds = scope.Feeds || { getUnread: function () { return 0; } };
  scope.Article = scope.Article || { cdmMoveToId: function () {} };

  scope.Notify = scope.Notify || {
    progress: function () {},
    close: function () {},
    error: function (msg) { console.warn(msg); },
    warning: function (msg) { console.warn(msg); },
    info: function (msg) { console.info(msg); }
  };

  // xhr.json(url, params, cb) is what af_readability and friends call.
  scope.xhr = scope.xhr || {
    json: function (url, params, callback) {
      const body = new URLSearchParams();

      Object.keys(params || {}).forEach(function (key) {
        body.append(key, params[key]);
      });
      body.append('csrf_token', scope.__csrf_token || '');

      fetch(url || 'backend.php', { method: 'POST', credentials: 'same-origin', body: body })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (typeof callback === 'function') callback(data);
        })
        .catch(function (err) { console.warn('plugin xhr failed', err); });
    }
  };

  // Minimal dijit/Dialog: a fixed overlay with a title, body and close button.
  function LegacyDialog(options) {
    this.options = options || {};
    this.node = null;
  }

  LegacyDialog.prototype.attr = function (name, value) {
    this.options[name] = value;
    return value;
  };

  LegacyDialog.prototype.set = function (name, value) {
    return this.attr(name, value);
  };

  LegacyDialog.prototype.render = function () {
    if (!this.node) {
      this.node = document.createElement('div');
      this.node.className = 'legacy-plugin-dialog';
      this.node.innerHTML =
        '<div class="legacy-plugin-dialog__card">' +
        '<div class="legacy-plugin-dialog__title"></div>' +
        '<div class="legacy-plugin-dialog__body"></div>' +
        '<button type="button" class="legacy-plugin-dialog__close">Close</button>' +
        '</div>';
      document.body.appendChild(this.node);

      const self = this;
      this.node.querySelector('.legacy-plugin-dialog__close').addEventListener('click', function () {
        self.hide();
      });
    }

    this.node.querySelector('.legacy-plugin-dialog__title').textContent = this.options.title || '';
    this.node.querySelector('.legacy-plugin-dialog__body').innerHTML = this.options.content || '';

    return this;
  };

  LegacyDialog.prototype.show = function () {
    this.render();
    this.node.style.display = 'flex';
    return this;
  };

  LegacyDialog.prototype.hide = function () {
    if (this.node) this.node.style.display = 'none';
    return this;
  };

  LegacyDialog.prototype.destroy = function () {
    if (this.node) {
      this.node.remove();
      this.node = null;
    }
  };

  scope.dijit = scope.dijit || {};
  scope.dijit.Dialog = scope.dijit.Dialog || LegacyDialog;

  if (!document.getElementById('legacy-plugin-dialog-css')) {
    const style = document.createElement('style');
    style.id = 'legacy-plugin-dialog-css';
    style.textContent = [
      '.legacy-plugin-dialog{position:fixed;inset:0;z-index:2400;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}',
      '.legacy-plugin-dialog__card{max-width:min(90vw,640px);max-height:80vh;overflow:auto;padding:16px;border-radius:6px;background:#fff;color:#222;box-shadow:0 12px 32px rgba(0,0,0,.35)}',
      '.legacy-plugin-dialog__title{font-weight:600;margin-bottom:8px}',
      '.legacy-plugin-dialog__close{margin-top:12px}'
    ].join('');
    document.head.appendChild(style);
  }
})();
