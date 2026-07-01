'use strict';

const { logger } = require('./logger');

// SQLite (better-sqlite3) es el motor único de Nexus Core desde la Fase 4 de la
// migración. El flag DB_ENGINE queda solo como traza informativa: cualquier valor
// distinto de 'sqlite' se ignora y se registra una advertencia.
if (process.env.DB_ENGINE && process.env.DB_ENGINE !== 'sqlite') {
  logger.warn(
    `[DB] DB_ENGINE='${process.env.DB_ENGINE}' ya no es soportado — PostgreSQL fue removido. Usando SQLite.`
  );
}

logger.info('[DB] Motor: SQLite (better-sqlite3)');

module.exports = require('./database.sqlite');
