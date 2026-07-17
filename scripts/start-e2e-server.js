'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.E2E_DATA_DIR || path.join(root, '.tmp', 'e2e'));

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

process.env.NODE_ENV = 'development';
process.env.HOST = '127.0.0.1';
process.env.PORT = process.env.E2E_PORT || '3201';
process.env.DATA_DIR = dataDir;
process.env.SESSION_SECRET = crypto.randomBytes(48).toString('hex');
delete process.env.ADMIN_BOOTSTRAP;
delete process.env.ADMIN_USERNAME;
delete process.env.ADMIN_PASSWORD;

require('../src/server');
