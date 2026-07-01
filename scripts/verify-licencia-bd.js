'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getAll, closeDB } = require('../backend/config/db');

try {
  const r = getAll(
    `SELECT clave, valor, actualizado_en FROM configuracion WHERE clave LIKE 'licencia%' ORDER BY clave`
  );
  console.log(JSON.stringify(r, null, 2));
  closeDB();
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
