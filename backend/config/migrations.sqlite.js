'use strict';

/**
 * Schema SQLite consolidado de Nexus Core (migraciones PG 001–044 en forma final).
 *
 * Reglas de esta capa (MIGRATION_PLAN Fase 2):
 *  - Todo el schema vive en este archivo, aplicado por runMigrations(db) con tabla _migrations.
 *  - Los triggers plpgsql de PG NO se portan: su lógica vive en los controllers dentro de
 *    transaction() (stock venta, costo promedio compra, historial de tasas).
 *  - Secuencias PG (ventas_numero_seq, cotizaciones_seq) → AUTOINCREMENT / MAX() en JS.
 *  - JSONB → TEXT (JSON.parse/stringify en JS) · BOOLEAN → INTEGER 0/1 · TIMESTAMP → TEXT ISO-8601.
 *
 * Nota: las tablas `cashea_cuotas` y `detalles_devolucion` mencionadas en el plan NO existen
 * en el dominio actual (las cuotas Cashea se derivan de cashea_config/ventas_cashea y las
 * líneas de devolución viven en devoluciones.lineas TEXT JSON) — no se crean tablas muertas.
 */

const { logger } = require('./logger');
const { FALLBACK_BY_ROLE } = require('../constants/rolePermissions');

/** Hash bcrypt de `admin123` — debe coincidir con 004_seed_data.sql y migrations.js (PG). */
const ADMIN_DEFAULT_PASSWORD_HASH =
  '$2a$10$YD93UDKrCaoufVSzuUh9/.RKBAYW3sTJObiKsplXK5O8gH2N/nN7a';

/** DEFAULT de timestamps: ISO-8601 UTC con milisegundos (mismo formato que new Date().toISOString()). */
const NOW_ISO = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// ─────────────────────────────────────────────────────────────────────────────
// Migración 1 — Tablas base (PG 001–010 consolidadas)
// ─────────────────────────────────────────────────────────────────────────────
function migracion1TablasBase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS configuracion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clave TEXT UNIQUE NOT NULL,
      valor TEXT NOT NULL,
      descripcion TEXT,
      categoria TEXT,
      actualizado_en TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      permisos TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre_completo TEXT NOT NULL,
      rol_id INTEGER REFERENCES roles(id),
      activo INTEGER DEFAULT 1,
      ultimo_acceso TEXT,
      creado_en TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      categoria_padre_id INTEGER REFERENCES categorias(id),
      icono TEXT,
      color_hex TEXT DEFAULT '#6366f1',
      activa INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS proveedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      rif TEXT,
      contacto_nombre TEXT,
      telefono TEXT,
      email TEXT,
      direccion TEXT,
      pais TEXT DEFAULT 'Venezuela',
      moneda_trabajo TEXT DEFAULT 'USD',
      condicion_pago TEXT,
      notas TEXT,
      activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT ${NOW_ISO}
    );

    -- CHECK stock_actual >= 0 viene del parche PG 019 (imposible de agregar por ALTER en SQLite,
    -- por eso se incluye desde la creación; la guarda STOCK_INSUFICIENTE vive en los controllers).
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_barras TEXT UNIQUE,
      codigo_interno TEXT UNIQUE,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      categoria_id INTEGER REFERENCES categorias(id),
      proveedor_id INTEGER REFERENCES proveedores(id),
      stock_actual NUMERIC DEFAULT 0 CHECK (stock_actual >= 0),
      stock_minimo NUMERIC DEFAULT 1,
      stock_maximo NUMERIC,
      unidad_medida TEXT DEFAULT 'unidad',
      costo_usd NUMERIC DEFAULT 0,
      costo_promedio_ponderado_usd NUMERIC DEFAULT 0,
      margen_ganancia_pct NUMERIC DEFAULT 30,
      precio_manual_usd NUMERIC,
      precio_mayorista_usd NUMERIC,
      precio_especial_usd NUMERIC,
      aplica_iva INTEGER DEFAULT 1,
      maneja_lotes INTEGER DEFAULT 0,
      fecha_vencimiento TEXT,
      imagen_path TEXT,
      ubicacion_almacen TEXT,
      notas TEXT,
      activo INTEGER DEFAULT 1,
      creado_por INTEGER REFERENCES usuarios(id),
      creado_en TEXT DEFAULT ${NOW_ISO},
      actualizado_en TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS lotes_producto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER REFERENCES productos(id),
      numero_lote TEXT,
      fecha_vencimiento TEXT,
      cantidad_inicial NUMERIC,
      cantidad_disponible NUMERIC,
      costo_usd NUMERIC,
      fecha_entrada TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT DEFAULT 'natural',
      cedula_rif TEXT UNIQUE,
      nombre TEXT NOT NULL,
      telefono TEXT,
      email TEXT,
      direccion TEXT,
      limite_credito_usd NUMERIC DEFAULT 0,
      descuento_habitual_porcentaje NUMERIC DEFAULT 0,
      saldo_deuda_usd NUMERIC DEFAULT 0,
      notas TEXT,
      activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS cajas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      ubicacion TEXT,
      activa INTEGER DEFAULT 1
    );

    -- Incluye las columnas del parche PG 008 (apertura/cierre multimoneda con conteo físico).
    CREATE TABLE IF NOT EXISTS sesiones_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caja_id INTEGER REFERENCES cajas(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      fecha_apertura TEXT DEFAULT ${NOW_ISO},
      fecha_cierre TEXT,
      monto_apertura_usd NUMERIC DEFAULT 0,
      monto_apertura_bs NUMERIC DEFAULT 0,
      monto_cierre_usd NUMERIC,
      monto_cierre_bs NUMERIC,
      tasa_dia NUMERIC DEFAULT 0,
      notas_cierre TEXT,
      estado TEXT DEFAULT 'abierta',
      monto_inicial_usd NUMERIC DEFAULT 0,
      monto_inicial_bs NUMERIC DEFAULT 0,
      tasa_bcv_apertura NUMERIC,
      tasa_usd_apertura NUMERIC,
      efectivo_usd_contado NUMERIC,
      efectivo_bs_contado NUMERIC,
      zelle_usd_contado NUMERIC DEFAULT 0,
      transferencias_bs_contado NUMERIC DEFAULT 0,
      pagos_moviles_bs_contado NUMERIC DEFAULT 0,
      punto_bs_contado NUMERIC DEFAULT 0,
      diferencia_usd NUMERIC,
      diferencia_bs NUMERIC
    );

    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_venta TEXT UNIQUE NOT NULL,
      sesion_caja_id INTEGER REFERENCES sesiones_caja(id),
      cliente_id INTEGER REFERENCES clientes(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      subtotal_usd NUMERIC DEFAULT 0,
      descuento_porcentaje NUMERIC DEFAULT 0,
      descuento_monto_usd NUMERIC DEFAULT 0,
      iva_porcentaje NUMERIC DEFAULT 0,
      iva_monto_usd NUMERIC DEFAULT 0,
      total_usd NUMERIC DEFAULT 0,
      total_bs NUMERIC DEFAULT 0,
      tasa_cambio_aplicada NUMERIC NOT NULL,
      metodo_pago TEXT,
      pagos TEXT DEFAULT '[]',
      estado TEXT DEFAULT 'completada',
      motivo_anulacion TEXT,
      notas TEXT,
      fecha_venta TEXT DEFAULT ${NOW_ISO},
      fecha_anulacion TEXT,
      anulada_por INTEGER REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS detalles_ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
      producto_id INTEGER REFERENCES productos(id),
      lote_id INTEGER REFERENCES lotes_producto(id),
      cantidad NUMERIC NOT NULL,
      precio_unitario_usd NUMERIC NOT NULL,
      costo_unitario_usd NUMERIC NOT NULL,
      descuento_porcentaje NUMERIC DEFAULT 0,
      subtotal_usd NUMERIC NOT NULL,
      margen_contribucion_usd NUMERIC,
      margen_porcentaje NUMERIC
    );

    CREATE TABLE IF NOT EXISTS ventas_suspendidas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referencia TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      sesion_caja_id INTEGER REFERENCES sesiones_caja(id),
      items TEXT NOT NULL,
      cliente_id INTEGER REFERENCES clientes(id),
      subtotal_usd NUMERIC,
      tasa_momento NUMERIC,
      creado_en TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS ajustes_inventario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER REFERENCES productos(id),
      lote_id INTEGER REFERENCES lotes_producto(id),
      tipo TEXT NOT NULL,
      cantidad NUMERIC NOT NULL,
      cantidad_anterior NUMERIC,
      cantidad_nueva NUMERIC,
      costo_unitario_usd NUMERIC,
      referencia_id INTEGER,
      referencia_tipo TEXT,
      motivo TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      fecha TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_compra TEXT UNIQUE NOT NULL,
      proveedor_id INTEGER REFERENCES proveedores(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      subtotal_usd NUMERIC DEFAULT 0,
      flete_usd NUMERIC DEFAULT 0,
      arancel_usd NUMERIC DEFAULT 0,
      total_usd NUMERIC DEFAULT 0,
      total_bs NUMERIC DEFAULT 0,
      tasa_cambio NUMERIC,
      estado TEXT DEFAULT 'pendiente',
      fecha_compra TEXT DEFAULT ${NOW_ISO},
      fecha_recepcion TEXT,
      notas TEXT
    );

    CREATE TABLE IF NOT EXISTS detalles_compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER REFERENCES compras(id) ON DELETE CASCADE,
      producto_id INTEGER REFERENCES productos(id),
      cantidad_pedida NUMERIC,
      cantidad_recibida NUMERIC DEFAULT 0,
      costo_unitario_usd NUMERIC,
      subtotal_usd NUMERIC
    );

    CREATE TABLE IF NOT EXISTS cuentas_cobrar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER REFERENCES ventas(id),
      cliente_id INTEGER REFERENCES clientes(id),
      monto_original_usd NUMERIC,
      monto_pagado_usd NUMERIC DEFAULT 0,
      saldo_pendiente_usd NUMERIC,
      fecha_vencimiento TEXT,
      estado TEXT DEFAULT 'pendiente',
      creado_en TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS pagos_credito (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuenta_cobrar_id INTEGER REFERENCES cuentas_cobrar(id),
      monto_usd NUMERIC,
      monto_bs NUMERIC,
      tasa_cambio NUMERIC,
      metodo_pago TEXT,
      referencia TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      fecha TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      accion TEXT NOT NULL,
      tabla_afectada TEXT,
      registro_id INTEGER,
      datos_anteriores TEXT,
      datos_nuevos TEXT,
      ip_address TEXT,
      fecha TEXT DEFAULT ${NOW_ISO}
    );

    -- PG 007: historial de tasas (el trigger plpgsql se reemplaza con lógica JS en preciosService).
    CREATE TABLE IF NOT EXISTS historial_tasas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL DEFAULT (date('now')) UNIQUE,
      tasa_bcv NUMERIC NOT NULL,
      tasa_usd NUMERIC NOT NULL,
      registrado_por INTEGER REFERENCES usuarios(id),
      creado_en TEXT DEFAULT ${NOW_ISO}
    );

    -- Índices PG 001 + 008
    CREATE INDEX IF NOT EXISTS idx_productos_barcode ON productos(codigo_barras);
    CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);
    CREATE INDEX IF NOT EXISTS idx_productos_stock ON productos(stock_actual) WHERE activo = 1;
    CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha_venta);
    CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON ventas(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado);
    CREATE INDEX IF NOT EXISTS idx_detalles_venta ON detalles_ventas(venta_id);
    CREATE INDEX IF NOT EXISTS idx_detalles_producto ON detalles_ventas(producto_id);
    CREATE INDEX IF NOT EXISTS idx_ajustes_producto ON ajustes_inventario(producto_id);
    CREATE INDEX IF NOT EXISTS idx_ajustes_fecha ON ajustes_inventario(fecha);
    CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha);
    CREATE INDEX IF NOT EXISTS idx_sesiones_caja_usuario_estado ON sesiones_caja(usuario_id, estado);
  `);

  // Seeds base (PG 001 + 004 + 007). Las tasas usan los valores del plan (tarea 2.3).
  const insConfig = db.prepare(
    `INSERT OR IGNORE INTO configuracion (clave, valor, categoria) VALUES (?, ?, ?)`
  );
  const configBase = [
    ['tasa_bcv', '40.00', 'moneda'],
    ['tasa_usd', '40.00', 'moneda'],
    ['margen_ganancia_default', '30', 'precios'],
    ['margen_ganancia_minimo', '5', 'precios'],
    ['nombre_empresa', 'Mi Local', 'empresa'],
    ['rif_empresa', 'J-000000000', 'empresa'],
    ['direccion_empresa', '', 'empresa'],
    ['telefono_empresa', '', 'empresa'],
    ['moneda_principal', 'USD', 'moneda'],
    ['impuesto_iva', '0', 'impuestos'],
    ['stock_alerta_dias', '7', 'alertas'],
    ['backup_automatico', 'true', 'sistema'],
    ['backup_intervalo_horas', '24', 'sistema']
  ];
  for (const [clave, valor, categoria] of configBase) {
    insConfig.run(clave, valor, categoria);
  }

  // Roles con la matriz de permisos FINAL (PG 009+010+012+023+040+044 consolidadas):
  // misma fuente de verdad que el backend (constants/rolePermissions.js).
  const insRol = db.prepare(`INSERT OR IGNORE INTO roles (nombre, permisos) VALUES (?, ?)`);
  insRol.run('admin', JSON.stringify({ all: true }));
  for (const rol of ['cajero', 'almacenista', 'supervisor', 'vendedor']) {
    insRol.run(rol, JSON.stringify(FALLBACK_BY_ROLE[rol]));
  }

  // PG 004: caja principal + usuario admin/admin123
  const hayCajas = db.prepare(`SELECT COUNT(*) AS n FROM cajas`).get();
  if (!hayCajas || Number(hayCajas.n) === 0) {
    db.prepare(`INSERT INTO cajas (nombre, ubicacion, activa) VALUES ('Caja principal', 'Mostrador', 1)`).run();
  }
  const rolAdmin = db.prepare(`SELECT id FROM roles WHERE nombre = 'admin' LIMIT 1`).get();
  db.prepare(
    `INSERT OR IGNORE INTO usuarios (username, password_hash, nombre_completo, rol_id, activo)
     VALUES ('admin', ?, 'Administrador', ?, 1)`
  ).run(ADMIN_DEFAULT_PASSWORD_HASH, rolAdmin.id);

  // PG 007: registro de tasas de hoy
  db.prepare(
    `INSERT OR IGNORE INTO historial_tasas (fecha, tasa_bcv, tasa_usd)
     VALUES (date('now'),
             (SELECT CAST(valor AS NUMERIC) FROM configuracion WHERE clave = 'tasa_bcv'),
             (SELECT CAST(valor AS NUMERIC) FROM configuracion WHERE clave = 'tasa_usd'))`
  ).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Migración 2 — Cashea, devoluciones e idempotencia (PG 011–025 consolidadas)
// ─────────────────────────────────────────────────────────────────────────────
function migracion2CasheaDevolucionesIdempotencia(db) {
  db.exec(`
    -- PG 012 + 027 + 038: cashea_config en forma final (6 niveles semilla→araguaney,
    -- Express, día de pago, línea comercial; sin columnas legacy BRONCE/PLATA/ORO).
    CREATE TABLE IF NOT EXISTS cashea_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activo INTEGER DEFAULT 1,
      comision_base_sobre_total_pct NUMERIC DEFAULT 4.00,
      modo_express_activo INTEGER DEFAULT 0,
      pct_express NUMERIC DEFAULT 0.00,
      pct_inicial_semilla NUMERIC NOT NULL DEFAULT 60.00,
      pct_inicial_raiz NUMERIC NOT NULL DEFAULT 50.00,
      pct_inicial_hoja NUMERIC NOT NULL DEFAULT 40.00,
      pct_inicial_tronco NUMERIC NOT NULL DEFAULT 40.00,
      pct_inicial_arbol NUMERIC NOT NULL DEFAULT 40.00,
      pct_inicial_araguaney NUMERIC NOT NULL DEFAULT 40.00,
      dia_pago_semana INTEGER NOT NULL DEFAULT 3 CHECK (dia_pago_semana BETWEEN 0 AND 6),
      comision_express_sobre_financiado_pct NUMERIC NOT NULL DEFAULT 0.00,
      linea_comercial TEXT NOT NULL DEFAULT 'Principal',
      created_at TEXT DEFAULT ${NOW_ISO},
      updated_at TEXT DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS cashea_liquidaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semana_inicio TEXT NOT NULL,
      semana_fin TEXT NOT NULL,
      fecha_liquidacion TEXT,
      total_bruto_usd NUMERIC DEFAULT 0,
      total_comisiones_usd NUMERIC DEFAULT 0,
      total_neto_usd NUMERIC DEFAULT 0,
      cantidad_ventas INTEGER DEFAULT 0,
      referencia_bancaria TEXT,
      notas TEXT,
      created_at TEXT DEFAULT ${NOW_ISO}
    );

    -- PG 012 + 027 + 032: nivel_cliente TEXT libre (semilla…araguaney), pct_inicial NUMERIC,
    -- total_venta_usd incluido, índice único por venta.
    CREATE TABLE IF NOT EXISTS ventas_cashea (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
      nivel_cliente TEXT NOT NULL,
      pct_inicial NUMERIC NOT NULL,
      monto_inicial_usd NUMERIC NOT NULL,
      monto_prestado_usd NUMERIC NOT NULL,
      comision_base_usd NUMERIC NOT NULL,
      comision_express_usd NUMERIC DEFAULT 0,
      total_comisiones_usd NUMERIC NOT NULL,
      modo_express INTEGER DEFAULT 0,
      pct_extra NUMERIC DEFAULT 0,
      neto_liquidacion_usd NUMERIC NOT NULL,
      neto_final_usd NUMERIC NOT NULL,
      estado_liquidacion TEXT DEFAULT 'PENDIENTE'
        CHECK (estado_liquidacion IN ('PENDIENTE','EN_PROCESO','LIQUIDADO','ANULADO')),
      liq_batch_id INTEGER REFERENCES cashea_liquidaciones(id),
      referencia_cashea TEXT,
      liquidado_at TEXT,
      created_at TEXT DEFAULT ${NOW_ISO},
      total_venta_usd NUMERIC
    );

    CREATE INDEX IF NOT EXISTS idx_ventas_cashea_estado ON ventas_cashea(estado_liquidacion);
    CREATE INDEX IF NOT EXISTS idx_ventas_cashea_venta ON ventas_cashea(venta_id);
    CREATE INDEX IF NOT EXISTS idx_ventas_cashea_created ON ventas_cashea(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_cashea_venta_id_unique ON ventas_cashea(venta_id);

    -- PG 017: devoluciones (las líneas viven en lineas TEXT JSON, no hay tabla detalle)
    CREATE TABLE IF NOT EXISTS devoluciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_devolucion TEXT NOT NULL UNIQUE,
      venta_id INTEGER REFERENCES ventas(id),
      cliente_id INTEGER REFERENCES clientes(id),
      cajero_id INTEGER REFERENCES usuarios(id),
      tipo TEXT NOT NULL DEFAULT 'devolucion' CHECK (tipo IN ('devolucion','cambio')),
      motivo TEXT,
      estado TEXT NOT NULL DEFAULT 'completada' CHECK (estado IN ('completada','anulada')),
      total_usd NUMERIC NOT NULL DEFAULT 0,
      total_bs NUMERIC NOT NULL DEFAULT 0,
      metodo_reembolso TEXT,
      lineas TEXT NOT NULL DEFAULT '[]',
      notas TEXT,
      creado_en TEXT NOT NULL DEFAULT ${NOW_ISO},
      actualizado_en TEXT NOT NULL DEFAULT ${NOW_ISO}
    );

    CREATE INDEX IF NOT EXISTS idx_devoluciones_venta ON devoluciones(venta_id);
    CREATE INDEX IF NOT EXISTS idx_devoluciones_cliente ON devoluciones(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_devoluciones_cajero ON devoluciones(cajero_id);

    -- PG 015: total Bs declarado por el cliente (huella forense)
    ALTER TABLE ventas ADD COLUMN total_bs_cliente NUMERIC;

    -- PG 021 + 024 + 031: idempotency_key con índice único parcial (usuario_id, key)
    ALTER TABLE ventas ADD COLUMN idempotency_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_idempotency_usuario_key
      ON ventas (usuario_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    -- PG 016: crédito USD BCV en cuentas_cobrar
    ALTER TABLE cuentas_cobrar ADD COLUMN tasa_bcv_pactada NUMERIC;
    ALTER TABLE cuentas_cobrar ADD COLUMN tasa_usd_pactada NUMERIC;
    ALTER TABLE cuentas_cobrar ADD COLUMN monto_usd_bcv NUMERIC;
    ALTER TABLE cuentas_cobrar ADD COLUMN notas TEXT;
    CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_cliente ON cuentas_cobrar(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_estado ON cuentas_cobrar(estado);

    -- PG 018: columnas faltantes de cartera
    ALTER TABLE cuentas_cobrar ADD COLUMN actualizado_en TEXT DEFAULT ${NOW_ISO};
    ALTER TABLE clientes ADD COLUMN actualizado_en TEXT DEFAULT ${NOW_ISO};
    ALTER TABLE pagos_credito ADD COLUMN cliente_id INTEGER REFERENCES clientes(id);
    ALTER TABLE pagos_credito ADD COLUMN notas TEXT;
    ALTER TABLE pagos_credito ADD COLUMN fecha_pago TEXT DEFAULT ${NOW_ISO};
    CREATE INDEX IF NOT EXISTS idx_pagos_credito_cliente ON pagos_credito(cliente_id);

    -- PG 020: sesiones huérfanas (la función plpgsql vive en cerrarSesionesHuerfanas JS)
    ALTER TABLE sesiones_caja ADD COLUMN cierre_forzado INTEGER DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_sesiones_caja_huerfanas
      ON sesiones_caja(estado, fecha_apertura) WHERE estado = 'abierta';

    -- PG 022: índice saldo por cliente+estado
    CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_cliente_estado
      ON cuentas_cobrar(cliente_id, estado);

    -- PG 025: override de permisos por usuario (JSONB → TEXT)
    ALTER TABLE usuarios ADD COLUMN permisos_override TEXT NOT NULL DEFAULT '{}';

    -- PG 013: búsqueda rápida (sin pg_trgm en SQLite; índices B-tree de apoyo,
    -- las búsquedas usan LIKE … COLLATE NOCASE)
    CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(nombre);
    CREATE INDEX IF NOT EXISTS idx_productos_codigo_interno ON productos(codigo_interno);
    CREATE INDEX IF NOT EXISTS idx_productos_activo_stock
      ON productos (activo, stock_actual DESC) WHERE activo = 1;
  `);

  // Seed fila única de cashea_config (PG 012/027) + tope de descuento (PG 015)
  const hayCashea = db.prepare(`SELECT COUNT(*) AS n FROM cashea_config`).get();
  if (!hayCashea || Number(hayCashea.n) === 0) {
    db.prepare(`INSERT INTO cashea_config (activo) VALUES (1)`).run();
  }
  db.prepare(
    `INSERT OR IGNORE INTO configuracion (clave, valor, categoria)
     VALUES ('venta_descuento_max_pct', '25', 'ventas')`
  ).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Migración 3 — Columnas monetarias y Cuentas por Pagar (PG 026–040 consolidadas)
// ─────────────────────────────────────────────────────────────────────────────
function migracion3MonetariasCxp(db) {
  db.exec(`
    -- PG 026: índices de performance de consultas
    CREATE INDEX IF NOT EXISTS idx_ventas_estado_fecha ON ventas (estado, fecha_venta);
    CREATE INDEX IF NOT EXISTS idx_ventas_usuario_id ON ventas (usuario_id);
    CREATE INDEX IF NOT EXISTS idx_ventas_cashea_liq_batch_id ON ventas_cashea (liq_batch_id)
      WHERE liq_batch_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_detalles_ventas_prod_venta ON detalles_ventas (producto_id, venta_id);

    -- PG 028: metadato de moneda del costo
    ALTER TABLE productos ADD COLUMN moneda_costo TEXT DEFAULT 'usd_fisico'
      CHECK (moneda_costo IN ('usd_fisico', 'bcv'));
    ALTER TABLE ajustes_inventario ADD COLUMN moneda_costo TEXT DEFAULT 'usd_fisico'
      CHECK (moneda_costo IN ('usd_fisico', 'bcv'));

    -- PG 029 + 030 + 037: referencia USD BCV y tasas aplicadas en ventas
    -- (tasa_cambio_aplicada ya existe desde la tabla base 001)
    ALTER TABLE ventas ADD COLUMN total_ref_usd_bcv NUMERIC;
    ALTER TABLE ventas ADD COLUMN tasa_bcv_aplicada NUMERIC;
    ALTER TABLE ventas ADD COLUMN total_bs_bcv_operativo NUMERIC;

    -- PG 039: compras a crédito
    ALTER TABLE compras ADD COLUMN tipo_pago TEXT NOT NULL DEFAULT 'contado';
    ALTER TABLE compras ADD COLUMN dias_credito INTEGER NOT NULL DEFAULT 0;

    -- PG 039: módulo Cuentas por Pagar
    CREATE TABLE IF NOT EXISTS cuentas_pagar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER REFERENCES compras(id) ON DELETE SET NULL,
      proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
      numero_referencia TEXT,
      monto_original_usd NUMERIC NOT NULL CHECK (monto_original_usd > 0),
      monto_pagado_usd NUMERIC NOT NULL DEFAULT 0 CHECK (monto_pagado_usd >= 0),
      saldo_usd NUMERIC NOT NULL CHECK (saldo_usd >= 0),
      tasa_bcv_pactada NUMERIC,
      fecha_vencimiento TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente','parcial','vencida','pagada','anulada')),
      notas TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      creado_en TEXT NOT NULL DEFAULT ${NOW_ISO},
      actualizado_en TEXT NOT NULL DEFAULT ${NOW_ISO}
    );

    CREATE TABLE IF NOT EXISTS pagos_proveedor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuenta_pagar_id INTEGER NOT NULL REFERENCES cuentas_pagar(id) ON DELETE CASCADE,
      proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
      monto_usd NUMERIC NOT NULL CHECK (monto_usd > 0),
      monto_bs NUMERIC,
      tasa_cambio NUMERIC,
      metodo_pago TEXT NOT NULL DEFAULT 'efectivo_usd',
      referencia TEXT,
      notas TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      creado_en TEXT NOT NULL DEFAULT ${NOW_ISO}
    );

    CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_proveedor ON cuentas_pagar(proveedor_id);
    CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_estado ON cuentas_pagar(estado);
    CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_vencimiento ON cuentas_pagar(fecha_vencimiento)
      WHERE estado IN ('pendiente','parcial','vencida');
    -- PG 040: una compra solo puede generar UNA cuenta por pagar
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_pagar_compra_unica ON cuentas_pagar(compra_id)
      WHERE compra_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_cuenta ON pagos_proveedor(cuenta_pagar_id);
  `);

  // Seeds PG 034 + 037 + claves de la tarea 2.3 del plan.
  // Los toggles usan 'true'/'false' (formato que leen bcvTasaAutoService/configuracion.controller).
  const insConfig = db.prepare(
    `INSERT OR IGNORE INTO configuracion (clave, valor, categoria, descripcion) VALUES (?, ?, ?, ?)`
  );
  insConfig.run(
    'tasa_bcv_feriados_ve',
    JSON.stringify([
      '2026-01-01', '2026-01-12', '2026-01-19', '2026-02-16', '2026-02-17', '2026-04-02',
      '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-24', '2026-06-29',
      '2026-07-24', '2026-09-14', '2026-10-12', '2026-10-26', '2026-11-23', '2026-12-14',
      '2026-12-24', '2026-12-25', '2026-12-31'
    ]),
    'moneda',
    'Calendario feriados VE 2026 para vigencia tasa BCV (nacionales + bancarios Sudeban)'
  );
  insConfig.run(
    'modo_moneda_operacion',
    'multimoneda',
    'moneda',
    'Modo operativo: multimoneda | solo_bcv. Única fuente de verdad para UI/POS.'
  );
  insConfig.run(
    'tasa_bcv_auto_activo',
    'false',
    'moneda',
    'Sincronización automática de tasa BCV (true/false). UI Configuración → Tasas.'
  );

  // PG 033: tarifas oficiales Cashea según línea comercial + modo express
  db.prepare(
    `UPDATE cashea_config SET
       comision_base_sobre_total_pct = CASE COALESCE(NULLIF(TRIM(linea_comercial), ''), 'Principal')
         WHEN 'Online' THEN 6.00
         WHEN 'CotidianaA' THEN 3.00
         WHEN 'CotidianaB' THEN 5.00
         ELSE 4.00
       END,
       comision_express_sobre_financiado_pct = CASE
         WHEN COALESCE(modo_express_activo, 0) != 1 THEN 0.00
         WHEN COALESCE(NULLIF(TRIM(linea_comercial), ''), 'Principal') = 'Online' THEN 0.00
         WHEN COALESCE(NULLIF(TRIM(linea_comercial), ''), 'Principal') = 'CotidianaA' THEN 1.00
         WHEN COALESCE(NULLIF(TRIM(linea_comercial), ''), 'Principal') = 'CotidianaB' THEN 2.00
         ELSE 2.00
       END
     WHERE id = (SELECT id FROM cashea_config ORDER BY id ASC LIMIT 1)`
  ).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Migración 4 — Descuento divisa, licencia y cotizaciones (PG 041–044 consolidadas)
// ─────────────────────────────────────────────────────────────────────────────
function migracion4Finales(db) {
  db.exec(`
    -- PG 041: auditoría de descuento al cobrar 100% en divisas
    ALTER TABLE ventas ADD COLUMN descuento_divisa_pct NUMERIC DEFAULT NULL;
    ALTER TABLE ventas ADD COLUMN descuento_divisa_monto_usd NUMERIC DEFAULT NULL;

    -- PG 042: auditoría de quién modificó configuracion
    ALTER TABLE configuracion ADD COLUMN actualizado_por INTEGER REFERENCES usuarios(id);

    -- PG 043: bitácora local de verificaciones de licencia (sin clave ni token)
    CREATE TABLE IF NOT EXISTS licencia_verificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verificado_en TEXT NOT NULL DEFAULT ${NOW_ISO},
      evento TEXT NOT NULL,
      resultado TEXT NOT NULL,
      motivo TEXT,
      tipo_licencia TEXT,
      license_key_masked TEXT,
      hwid_prefix TEXT,
      origen TEXT NOT NULL DEFAULT 'cliente'
    );
    CREATE INDEX IF NOT EXISTS idx_licencia_verificaciones_fecha
      ON licencia_verificaciones (verificado_en DESC);

    -- PG 044: módulo de cotizaciones (cotizaciones_seq → numeración MAX() en JS)
    CREATE TABLE IF NOT EXISTS cotizaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      fecha_emision TEXT NOT NULL DEFAULT ${NOW_ISO},
      fecha_vencimiento TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador','enviada','aceptada','rechazada','vencida','anulada')),
      iva_porcentaje NUMERIC NOT NULL DEFAULT 0,
      iva_monto_usd NUMERIC NOT NULL DEFAULT 0,
      descuento_porcentaje NUMERIC NOT NULL DEFAULT 0,
      descuento_monto_usd NUMERIC NOT NULL DEFAULT 0,
      subtotal_usd NUMERIC NOT NULL DEFAULT 0,
      total_usd NUMERIC NOT NULL DEFAULT 0,
      total_bs NUMERIC NOT NULL DEFAULT 0,
      tasa_bcv NUMERIC NOT NULL DEFAULT 0,
      notas TEXT,
      created_at TEXT NOT NULL DEFAULT ${NOW_ISO},
      updated_at TEXT NOT NULL DEFAULT ${NOW_ISO}
    );

    CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id ON cotizaciones(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON cotizaciones(estado);
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha_emision ON cotizaciones(fecha_emision DESC);

    CREATE TABLE IF NOT EXISTS detalles_cotizaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
      producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
      descripcion TEXT NOT NULL,
      cantidad NUMERIC NOT NULL DEFAULT 1,
      precio_unitario_usd NUMERIC NOT NULL DEFAULT 0,
      subtotal_usd NUMERIC NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_detalles_cotizaciones_cot ON detalles_cotizaciones(cotizacion_id);
  `);

  // PG 041: claves de configuración del descuento divisa
  const insConfig = db.prepare(
    `INSERT OR IGNORE INTO configuracion (clave, valor, categoria, descripcion) VALUES (?, ?, ?, ?)`
  );
  insConfig.run(
    'descuento_cobro_divisa_activo', 'false', 'ventas',
    'Activar descuento al cobrar 100 % en Efectivo USD o Zelle (solo modo multimoneda)'
  );
  insConfig.run(
    'descuento_cobro_divisa_pct', '0', 'ventas',
    'Porcentaje de descuento sobre ref. $ BCV al cobrar 100 % en USD/Zelle (0–100, step 0.5)'
  );

  // PG 044: permiso cotizaciones_all en roles que no son admin ({all:true} lo cubre).
  // La matriz seed (rolePermissions.js) ya lo incluye; este merge cubre BDs creadas
  // con versiones previas de la migración 1.
  const roles = db.prepare(`SELECT id, nombre, permisos FROM roles WHERE nombre != 'admin'`).all();
  const updRol = db.prepare(`UPDATE roles SET permisos = ? WHERE id = ?`);
  for (const rol of roles) {
    let permisos = {};
    try { permisos = JSON.parse(rol.permisos || '{}'); } catch { permisos = {}; }
    if (permisos.all === true) continue;
    if (!Object.prototype.hasOwnProperty.call(permisos, 'cotizaciones_all')) {
      permisos.cotizaciones_all = ['supervisor', 'vendedor', 'cajero'].includes(rol.nombre);
      updRol.run(JSON.stringify(permisos), rol.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migración 5 — Reconciliación de seed: matriz de permisos final, admin y config
// (equivalente a PG 009+023+ensureSemillaAdminSiFalta: merge idempotente)
// ─────────────────────────────────────────────────────────────────────────────
function migracion5SeedCompleto(db) {
  // Roles: garantizar que existen los 5 y que su matriz contiene TODAS las claves
  // de la matriz final (merge sin pisar personalizaciones existentes).
  const upsertRol = db.prepare(`INSERT OR IGNORE INTO roles (nombre, permisos) VALUES (?, ?)`);
  upsertRol.run('admin', JSON.stringify({ all: true }));
  for (const rol of ['cajero', 'almacenista', 'supervisor', 'vendedor']) {
    upsertRol.run(rol, JSON.stringify(FALLBACK_BY_ROLE[rol]));
  }

  const roles = db.prepare(`SELECT id, nombre, permisos FROM roles`).all();
  const updRol = db.prepare(`UPDATE roles SET permisos = ? WHERE id = ?`);
  for (const rol of roles) {
    if (rol.nombre === 'admin') {
      updRol.run(JSON.stringify({ all: true }), rol.id);
      continue;
    }
    const matriz = FALLBACK_BY_ROLE[rol.nombre];
    if (!matriz) continue;
    let permisos = {};
    try { permisos = JSON.parse(rol.permisos || '{}'); } catch { permisos = {}; }
    let cambio = false;
    for (const [clave, valor] of Object.entries(matriz)) {
      if (!Object.prototype.hasOwnProperty.call(permisos, clave)) {
        permisos[clave] = valor;
        cambio = true;
      }
    }
    if (cambio) updRol.run(JSON.stringify(permisos), rol.id);
  }

  // Usuario admin garantizado y asignado al rol admin (semilla 004 / ensureSemillaAdminSiFalta).
  const rolAdmin = db.prepare(`SELECT id FROM roles WHERE nombre = 'admin' LIMIT 1`).get();
  const admin = db
    .prepare(`SELECT id, rol_id FROM usuarios WHERE LOWER(TRIM(username)) = 'admin' LIMIT 1`)
    .get();
  if (!admin) {
    db.prepare(
      `INSERT INTO usuarios (username, password_hash, nombre_completo, rol_id, activo)
       VALUES ('admin', ?, 'Administrador', ?, 1)`
    ).run(ADMIN_DEFAULT_PASSWORD_HASH, rolAdmin.id);
  } else if (Number(admin.rol_id) !== Number(rolAdmin.id)) {
    db.prepare(`UPDATE usuarios SET rol_id = ? WHERE id = ?`).run(rolAdmin.id, admin.id);
  }

  // Caja principal garantizada.
  const hayCajas = db.prepare(`SELECT COUNT(*) AS n FROM cajas`).get();
  if (!hayCajas || Number(hayCajas.n) === 0) {
    db.prepare(`INSERT INTO cajas (nombre, ubicacion, activa) VALUES ('Caja principal', 'Mostrador', 1)`).run();
  }

  // Claves de configuración por defecto que el plan exige presentes (INSERT OR IGNORE:
  // no pisa valores ya configurados por el usuario).
  const insConfig = db.prepare(
    `INSERT OR IGNORE INTO configuracion (clave, valor, categoria) VALUES (?, ?, ?)`
  );
  const defaults = [
    ['tasa_bcv', '40.00', 'moneda'],
    ['tasa_usd', '40.00', 'moneda'],
    ['modo_moneda_operacion', 'multimoneda', 'moneda'],
    ['impuesto_iva', '0', 'impuestos'],
    ['tasa_bcv_auto_activo', 'false', 'moneda'],
    ['descuento_cobro_divisa_activo', 'false', 'ventas'],
    ['descuento_cobro_divisa_pct', '0', 'ventas'],
    ['venta_descuento_max_pct', '25', 'ventas'],
    ['margen_ganancia_default', '30', 'precios'],
    ['margen_ganancia_minimo', '5', 'precios'],
    ['nombre_empresa', 'Mi Local', 'empresa'],
    ['rif_empresa', 'J-000000000', 'empresa'],
    ['moneda_principal', 'USD', 'moneda'],
    ['stock_alerta_dias', '7', 'alertas'],
    ['backup_automatico', 'true', 'sistema'],
    ['backup_intervalo_horas', '24', 'sistema']
  ];
  for (const [clave, valor, categoria] of defaults) {
    insConfig.run(clave, valor, categoria);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migración 6 — Modo red multi-cajero (Fase 6 del plan)
// ─────────────────────────────────────────────────────────────────────────────
function migracion6ModoRed(db) {
  db.prepare(
    `INSERT OR IGNORE INTO configuracion (clave, valor, descripcion, categoria)
     VALUES ('modo_red_activo', '0', 'Permitir cajeros adicionales en la red local (0/1). Requiere reiniciar.', 'sistema')`
  ).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de migraciones (las tareas 2.2–2.5 agregan entradas a este array)
// ─────────────────────────────────────────────────────────────────────────────
const MIGRATIONS = [
  { version: 1, nombre: 'tablas_base_pg_001_010', up: migracion1TablasBase },
  { version: 2, nombre: 'cashea_devoluciones_idempotencia_pg_011_025', up: migracion2CasheaDevolucionesIdempotencia },
  { version: 3, nombre: 'monetarias_cxp_pg_026_040', up: migracion3MonetariasCxp },
  { version: 4, nombre: 'finales_descuento_divisa_licencia_cotizaciones_pg_041_044', up: migracion4Finales },
  { version: 5, nombre: 'seed_completo_roles_admin_config_indices', up: migracion5SeedCompleto },
  { version: 6, nombre: 'modo_red_multicajero', up: migracion6ModoRed }
];

/**
 * Aplica las migraciones pendientes dentro de una transacción cada una,
 * registrándolas en _migrations para no re-aplicar parches.
 * @param {import('better-sqlite3').Database} db
 */
function runMigrations(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       version INTEGER PRIMARY KEY,
       nombre TEXT,
       aplicada_en TEXT
     )`
  );

  const aplicadas = new Set(
    db.prepare(`SELECT version FROM _migrations`).all().map((r) => Number(r.version))
  );

  let aplicadasAhora = 0;
  for (const m of MIGRATIONS) {
    if (aplicadas.has(m.version)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare(
        `INSERT INTO _migrations (version, nombre, aplicada_en) VALUES (?, ?, ?)`
      ).run(m.version, m.nombre, new Date().toISOString());
    });
    tx();
    aplicadasAhora += 1;
    logger.info(`[SQLite] Migración ${m.version} aplicada: ${m.nombre}`);
  }

  return { total: MIGRATIONS.length, aplicadas: aplicadasAhora };
}

/**
 * Reemplaza la función plpgsql cerrar_sesiones_huerfanas(horas) del parche PG 020.
 * Cierra sesiones de caja 'abierta' con más de `horasMaximas` horas.
 * @param {import('better-sqlite3').Database} db
 */
function cerrarSesionesHuerfanas(db, horasMaximas = 24) {
  const limite = new Date(Date.now() - horasMaximas * 3600 * 1000).toISOString();
  const huerfanas = db
    .prepare(
      `SELECT id, usuario_id, fecha_apertura FROM sesiones_caja
       WHERE estado = 'abierta' AND fecha_cierre IS NULL AND fecha_apertura < ?`
    )
    .all(limite);

  if (huerfanas.length === 0) return { cerradas: 0, sesiones: [] };

  const cerrar = db.prepare(
    `UPDATE sesiones_caja
     SET estado = 'cerrada',
         fecha_cierre = ?,
         cierre_forzado = 1,
         notas_cierre = COALESCE(notas_cierre || char(10), '') ||
                        'Cierre automático por sesión huérfana (>' || ? || 'h sin actividad)'
     WHERE id = ?`
  );
  const ahora = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const s of huerfanas) cerrar.run(ahora, horasMaximas, s.id);
  });
  tx();

  logger.warn('[SQLite] Sesiones de caja huérfanas cerradas automáticamente', {
    cantidad: huerfanas.length,
    ids: huerfanas.map((s) => s.id),
    horasMaximas
  });
  return { cerradas: huerfanas.length, sesiones: huerfanas };
}

module.exports = {
  runMigrations,
  cerrarSesionesHuerfanas,
  ADMIN_DEFAULT_PASSWORD_HASH
};
