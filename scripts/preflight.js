'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'historial.db');
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
requireCondition(nodeMajor >= 20, 'Node.js debe ser 20 o superior.');
requireCondition(fs.existsSync(path.join(ROOT, 'package-lock.json')), 'Falta package-lock.json.');
requireCondition(process.env.NODE_ENV === 'production', 'NODE_ENV debe ser production.');
requireCondition(
  typeof process.env.SESSION_SECRET === 'string' && process.env.SESSION_SECRET.length >= 64,
  'SESSION_SECRET debe existir y tener al menos 64 caracteres.'
);
requireCondition(
  ['127.0.0.1', '::1', 'localhost'].includes(process.env.HOST || '127.0.0.1'),
  'HOST debe ser loopback.'
);
requireCondition(fs.existsSync(DB_FILE), `Falta SQLite en ${DB_FILE}.`);

if (fs.existsSync(DB_FILE)) {
  const db = new Database(DB_FILE, { readonly: true, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    requireCondition(db.pragma('quick_check', { simple: true }) === 'ok', 'PRAGMA quick_check no devolvió ok.');
    requireCondition(db.pragma('foreign_keys', { simple: true }) === 1, 'foreign_keys debe estar activo.');
    db.prepare('SELECT 1').get();
  } catch (error) {
    failures.push(`SQLite no está listo: ${error.message}`);
  } finally {
    db.close();
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`preflight: ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  success: true,
  node: process.versions.node,
  environment: 'production',
  host: process.env.HOST || '127.0.0.1',
  database: 'ok',
  secrets: 'present-and-redacted',
}));
