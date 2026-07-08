'use strict';

const { Store } = require('express-session');

class SQLiteSessionStore extends Store {
  constructor(options = {}) {
    super(options);
    this.client = options.client;
    if (!this.client) throw new Error('SQLiteSessionStore requires { client: db }');

    this.table = options.table || 'sessions';
    this.client.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        sid     TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
        sess    TEXT NOT NULL,
        expired INTEGER NOT NULL
      )
    `);

    if (options.expired?.clear) {
      const intervalMs = options.expired.intervalMs || 900000;
      this._cleanupTimer = setInterval(() => this.clearExpired(), intervalMs);
      if (typeof this._cleanupTimer.unref === 'function') this._cleanupTimer.unref();
    }
  }

  clearExpired() {
    this.client.prepare(`DELETE FROM ${this.table} WHERE ? > expired`).run(Date.now());
  }

  /** Conteo de sesiones activas (no expiradas) — usado por el health check. */
  countActive() {
    try {
      const row = this.client
        .prepare(`SELECT COUNT(*) AS c FROM ${this.table} WHERE ? <= expired`)
        .get(Date.now());
      return row ? row.c : 0;
    } catch (_) {
      return 0;
    }
  }

  get(sid, callback) {
    try {
      const row = this.client
        .prepare(`SELECT sess FROM ${this.table} WHERE sid = ? AND ? <= expired`)
        .get(sid, Date.now());
      if (!row) return callback();
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = sess?.cookie?.maxAge;
      const now = Date.now();
      const expired = maxAge ? now + maxAge : now + 86400000;
      this.client
        .prepare(`INSERT OR REPLACE INTO ${this.table} (sid, expired, sess) VALUES (?, ?, ?)`)
        .run(sid, expired, JSON.stringify(sess));
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.client.prepare(`DELETE FROM ${this.table} WHERE sid = ?`).run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      if (!sess?.cookie?.expires) return callback(null);
      const expired = new Date(sess.cookie.expires).getTime();
      this.client
        .prepare(`UPDATE ${this.table} SET expired = ? WHERE sid = ? AND ? <= expired`)
        .run(expired, sid, Date.now());
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

module.exports = SQLiteSessionStore;
