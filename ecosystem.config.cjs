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
      // Punto inicial medido para el VPS de 1 GB; revisar con 24 h de métricas.
      node_args: '--max-old-space-size=320',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '127.0.0.1',
        // DATA_DIR: path.join(root, 'data'),
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '127.0.0.1',
        // SESSION_SECRET se inyecta desde el entorno/secret manager del host.
        // El bootstrap de admin es un comando explícito; nunca vive aquí.
      },
    },
  ],
};
