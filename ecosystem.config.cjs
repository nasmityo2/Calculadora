'use strict';

/** PM2: desde la raíz del repo → pm2 start ecosystem.config.cjs */
const path = require('path');
const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'calculadora',
      cwd: root,
      script: path.join(root, 'src', 'server.js'),
      // Limita el heap V8 a 512 MB: con 1 GB de RAM evita que el proceso
      // crezca sin control antes de que PM2 lo reinicie.
      node_args: '--max-old-space-size=512',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // DATA_DIR: path.join(root, 'data'),
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        SESSION_SECRET: process.env.SESSION_SECRET || 'cambiar-en-produccion-usar-variable-de-entorno',
        ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
      },
    },
  ],
};
