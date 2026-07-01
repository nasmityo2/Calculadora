-- ============================================================
-- PARCHE 044: Módulo de Cotizaciones
-- Tablas: cotizaciones, detalles_cotizaciones
-- Permiso nuevo: cotizaciones_all
-- ============================================================

-- Tabla principal de cotizaciones
CREATE TABLE IF NOT EXISTS cotizaciones (
  id                    SERIAL PRIMARY KEY,
  numero                VARCHAR(32)       NOT NULL UNIQUE,
  cliente_id            INTEGER           REFERENCES clientes(id) ON DELETE SET NULL,
  usuario_id            INTEGER           REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_emision         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  fecha_vencimiento     DATE              NOT NULL,
  estado                VARCHAR(20)       NOT NULL DEFAULT 'borrador'
                          CHECK (estado IN ('borrador','enviada','aceptada','rechazada','vencida','anulada')),
  iva_porcentaje        NUMERIC(5,2)      NOT NULL DEFAULT 0,
  iva_monto_usd         NUMERIC(18,4)     NOT NULL DEFAULT 0,
  descuento_porcentaje  NUMERIC(5,2)      NOT NULL DEFAULT 0,
  descuento_monto_usd   NUMERIC(18,4)     NOT NULL DEFAULT 0,
  subtotal_usd          NUMERIC(18,4)     NOT NULL DEFAULT 0,
  total_usd             NUMERIC(18,4)     NOT NULL DEFAULT 0,
  total_bs              NUMERIC(18,2)     NOT NULL DEFAULT 0,
  tasa_bcv              NUMERIC(18,4)     NOT NULL DEFAULT 0,
  notas                 TEXT,
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- Índices de búsqueda frecuente
CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id    ON cotizaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado        ON cotizaciones(estado);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha_emision ON cotizaciones(fecha_emision DESC);

-- Detalles (líneas) de cada cotización
CREATE TABLE IF NOT EXISTS detalles_cotizaciones (
  id                    SERIAL PRIMARY KEY,
  cotizacion_id         INTEGER           NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  producto_id           INTEGER           REFERENCES productos(id) ON DELETE SET NULL,
  descripcion           VARCHAR(255)      NOT NULL,
  cantidad              NUMERIC(12,3)     NOT NULL DEFAULT 1,
  precio_unitario_usd   NUMERIC(18,4)     NOT NULL DEFAULT 0,
  subtotal_usd          NUMERIC(18,4)     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_detalles_cotizaciones_cot ON detalles_cotizaciones(cotizacion_id);

-- Secuencia para numeración automática de cotizaciones (COT-YYYY-NNNNN)
CREATE SEQUENCE IF NOT EXISTS cotizaciones_seq START 1;

-- Permiso nuevo en todos los roles que tengan permisos JSON
-- Admin: all:true cubre automáticamente. Para otros roles, insertar cotizaciones_all=true
-- según política de negocio. El parche agrega cotizaciones_all al rol supervisor.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'roles') THEN
    UPDATE roles
       SET permisos = permisos || '{"cotizaciones_all": true}'::jsonb
     WHERE nombre IN ('admin', 'supervisor')
       AND NOT (permisos ? 'all');

    -- Vendedor y cajero también pueden ver/crear cotizaciones
    UPDATE roles
       SET permisos = permisos || '{"cotizaciones_all": true}'::jsonb
     WHERE nombre IN ('vendedor', 'cajero')
       AND NOT (permisos ? 'all');
  END IF;
END;
$$;
