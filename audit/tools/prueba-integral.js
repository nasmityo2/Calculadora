'use strict';
/* Prueba integral 3D.4 — Nexus Core sobre SQLite (cliente HTTP puro, Node >= 18).
 * Replica las fórmulas de redondeo de PreciosService para construir payloads
 * de venta que pasen la verificación anti-manipulación del servidor. */

const BASE = 'http://127.0.0.1:3000';
const resultados = [];
let token = null;

const round4 = (x) => Math.round(x * 10000) / 10000;
const round2 = (x) => Math.round(x * 100) / 100;
const tasa4 = (t) => Math.round(Number(t) * 10000) / 10000;
// Espejo de PreciosService.totalBolivaresDesdeRefUsdBcv
const totalBsDesdeRefBcv = (refUsd, tasaBcv) =>
  Math.round((Number(refUsd) * Math.round(tasa4(tasaBcv) * 10000)) / 100) / 100;

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.error) || text.slice(0, 200);
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function apiBin(path) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length;
}

async function paso(nombre, fn) {
  try {
    const detalle = await fn();
    resultados.push({ paso: nombre, ok: true, detalle: String(detalle || '') });
    process.stdout.write(`[OK] ${nombre} — ${detalle}\n`);
  } catch (e) {
    resultados.push({ paso: nombre, ok: false, detalle: e.message });
    process.stdout.write(`[FALLO] ${nombre} — ${e.message}\n`);
  }
}

/** Construye una venta coherente con la validación del servidor. */
async function armarVenta(prodId, cantidad) {
  const prod = await api('GET', `/api/productos/${prodId}`);
  const pc = prod.precios_calculados;
  const tasas = await api('GET', '/api/configuracion/tasas-actuales');
  const pu = Number(pc.precio_usd_efectivo);
  const pbcv = Number(pc.precio_usd_bcv);
  const totalUsd = round4(cantidad * pu);
  const refBcv = round4(cantidad * pbcv);
  const totalBs = totalBsDesdeRefBcv(refBcv, tasas.tasa_bcv);
  return { prod, tasas, totalUsd, refBcv, totalBs };
}

async function main() {
  // ── 1. Login ────────────────────────────────────────────────────
  await paso('Login', async () => {
    const r = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    if (!r.token) throw new Error('sin token');
    token = r.token;
    return `JWT para ${r.user.username}, permisos.all=${r.user.permisos && r.user.permisos.all}`;
  });

  // ── 2. Dashboard ────────────────────────────────────────────────
  await paso('Dashboard KPIs', async () => {
    const r = await api('GET', '/api/dashboard/resumen');
    return `ventas_hoy_bcv=${r.kpis.ventas_hoy_bcv} serie7d=${r.ventas7d.length} dias`;
  });

  // ── 3. Crear y editar producto ──────────────────────────────────
  let prodId = null;
  await paso('Crear producto', async () => {
    const r = await api('POST', '/api/productos', {
      nombre: 'Arroz Primor 1kg',
      codigo_barras: '7591001999999',
      costo_usd: 0.95,
      margen_ganancia_pct: 28,
      stock_actual: 200,
      stock_minimo: 20
    });
    prodId = r.id;
    return `id=${r.id} sku=${r.codigo_interno} stock=${r.stock_actual}`;
  });
  await paso('Editar producto', async () => {
    const r = await api('PATCH', `/api/productos/${prodId}`, { margen_ganancia_pct: 32 });
    return `margen 28 -> ${r.margen_ganancia_pct}`;
  });

  // ── 4. Abrir caja ───────────────────────────────────────────────
  await paso('Abrir caja', async () => {
    const r = await api('POST', '/api/caja/abrir', { monto_inicial_usd: 200, monto_inicial_bs: 10000 });
    return `sesion=${r.sesion.id} tasa_bcv_apertura=${r.sesion.tasa_bcv_apertura}`;
  });

  // ── 5. Venta POS cobro mixto USD + Bs ───────────────────────────
  let ventaMixtaId = null;
  await paso('Venta cobro mixto', async () => {
    const cant = 4;
    const { tasas, totalUsd, totalBs } = await armarVenta(prodId, cant);
    const usdParte = round2(totalUsd / 2);
    // Resto en Bs a tasa calle: (totalUsd - usdParte) * tasa_usd
    const bsParte = round2((totalUsd - usdParte) * tasa4(tasas.tasa_usd));
    const r = await api('POST', '/api/ventas', {
      items: [{ producto_id: prodId, cantidad: cant }],
      total_usd: totalUsd,
      total_bs: totalBs,
      metodo_pago: 'mixto',
      pagos: [
        { metodo: 'efectivo_usd', moneda: 'USD', monto: usdParte },
        { metodo: 'efectivo_bs', moneda: 'BS', monto: bsParte }
      ],
      idempotency_key: `integral-mixto-${Date.now()}`
    });
    ventaMixtaId = r.id;
    return `${r.numero_venta} total_usd=${r.total_usd} total_bs=${r.total_bs} (USD ${usdParte} + Bs ${bsParte})`;
  });

  // ── 6. Cliente + venta crédito + abonos Bs y USD ────────────────
  let clienteId = null;
  await paso('Crear cliente', async () => {
    const r = await api('POST', '/api/clientes', {
      nombre: 'Pedro Gomez',
      cedula_rif: 'V-98765432',
      telefono: '04241112233',
      limite_credito_usd: 300
    });
    clienteId = r.id;
    return `id=${r.id}`;
  });
  await paso('Venta a credito + abonos Bs y USD', async () => {
    const cant = 1;
    const { totalUsd, refBcv, totalBs } = await armarVenta(prodId, cant);
    const venta = await api('POST', '/api/ventas', {
      items: [{ producto_id: prodId, cantidad: cant }],
      cliente_id: clienteId,
      total_usd: totalUsd,
      total_bs: totalBs,
      metodo_pago: 'credito',
      pagos: [{ metodo: 'credito', moneda: 'USD_BCV', monto: refBcv }],
      idempotency_key: `integral-credito-${Date.now()}`
    });
    const ctas = await api('GET', `/api/clientes/cartera/cuentas?cliente_id=${clienteId}`);
    const lista = ctas.cuentas || ctas;
    if (!lista.length) throw new Error('no se creo cuenta por cobrar');
    const ctaId = lista[0].id;
    const ab1 = await api('POST', `/api/clientes/cartera/cuentas/${ctaId}/abono`, {
      metodo: 'efectivo_bs', monto_bs: 300
    });
    const ab2 = await api('POST', `/api/clientes/cartera/cuentas/${ctaId}/abono`, {
      metodo: 'efectivo_usd', monto_usd: 0.3
    });
    return `${venta.numero_venta} cta=${ctaId} abonoBs->USD ${ab1.monto_aplicado ?? ab1.abono?.monto_usd} abonoUsd ${ab2.monto_aplicado ?? ab2.abono?.monto_usd}`;
  });

  // ── 7. Cotización + PDF ─────────────────────────────────────────
  await paso('Cotizacion + PDF', async () => {
    const cot = await api('POST', '/api/cotizaciones', {
      cliente_id: clienteId,
      fecha_vencimiento: '2026-07-15',
      iva_porcentaje: 0,
      descuento_porcentaje: 0,
      lineas: [{ producto_id: prodId, descripcion: 'Arroz Primor 1kg', cantidad: 12, precio_unitario_usd: 1.35 }]
    });
    await api('PATCH', `/api/cotizaciones/${cot.id}/estado`, { estado: 'enviada' });
    const bytes = await apiBin(`/api/cotizaciones/${cot.id}/pdf`);
    return `${cot.numero} estado=enviada PDF ${bytes} bytes`;
  });

  // ── 8. Reporte ventas período ───────────────────────────────────
  await paso('Reporte ventas periodo', async () => {
    const r = await api('GET', '/api/reportes/ventas-periodo?dias=7');
    const hoy = r[r.length - 1];
    return `dias=${r.length} hoy: ventas=${hoy ? hoy.num_ventas : 0} total_bcv=${hoy ? hoy.total_bcv : 0}`;
  });

  // ── 9. Excel inventario ─────────────────────────────────────────
  await paso('Excel inventario (control precios)', async () => {
    const bytes = await apiBin('/api/reportes/excel/control-precios');
    if (bytes < 1000) throw new Error(`archivo sospechoso (${bytes} bytes)`);
    return `${bytes} bytes`;
  });

  // ── 10. Modo moneda bloqueado con caja abierta ──────────────────
  await paso('Modo moneda rechazado con caja abierta', async () => {
    try {
      await api('PATCH', '/api/configuracion/modo-moneda', { modo_moneda_operacion: 'solo_bcv' });
      throw new Error('NO rechazo el cambio con caja abierta');
    } catch (e) {
      if (e.status === 409) return 'rechazado 409 correcto';
      throw e;
    }
  });

  // ── 11. Cerrar caja ─────────────────────────────────────────────
  await paso('Cerrar caja', async () => {
    const resumen = await api('GET', '/api/caja/resumen-cierre');
    const esp = resumen.montosEsperados;
    const r = await api('POST', '/api/caja/cerrar', {
      efectivo_usd_contado: esp.efectivo_usd,
      efectivo_bs_contado: esp.efectivo_bs,
      zelle_usd: esp.zelle_usd,
      transferencias_bs: esp.transferencia_bs,
      pagos_moviles_bs: esp.pago_movil_bs,
      punto_bs: esp.punto_bs
    });
    return `dif_usd=${r.diferencias.usd} (${r.diferencias.usd_estado}) dif_bs=${r.diferencias.bs} (${r.diferencias.bs_estado})`;
  });

  // ── 12. Cambiar modo moneda (multimoneda ↔ solo_bcv) ────────────
  await paso('Cambiar modo moneda y volver', async () => {
    const r1 = await api('PATCH', '/api/configuracion/modo-moneda', { modo_moneda_operacion: 'solo_bcv' });
    const r2 = await api('PATCH', '/api/configuracion/modo-moneda', {
      modo_moneda_operacion: 'multimoneda', tasa_usd: 625
    });
    return `solo_bcv usd=${r1.tasa_usd} | multimoneda usd=${r2.tasa_usd}`;
  });

  // ── 13. Tasa BCV manual ─────────────────────────────────────────
  await paso('Actualizar tasa BCV manual', async () => {
    const r = await api('POST', '/api/configuracion/tasas', { tasa_bcv: 565.5, tasa_usd: 625 });
    const hist = await api('GET', '/api/reportes/historial-tasas');
    return `bcv=${r.tasa_bcv} usd=${r.tasa_usd} historial_hoy=${hist[0] ? hist[0].tasa_bcv : 'N/A'}`;
  });

  // ── 14. Devolución parcial ──────────────────────────────────────
  await paso('Devolucion parcial', async () => {
    const antes = (await api('GET', `/api/productos/${prodId}`)).stock_actual;
    const r = await api('POST', '/api/devoluciones', {
      venta_id: ventaMixtaId,
      tipo: 'devolucion',
      motivo: 'prueba integral',
      metodo_reembolso: 'efectivo_usd',
      lineas: [{ producto_id: prodId, cantidad: 1 }]
    });
    const despues = (await api('GET', `/api/productos/${prodId}`)).stock_actual;
    return `${r.numero_devolucion} stock ${antes} -> ${despues}`;
  });

  // ── 15. Venta con Cashea ────────────────────────────────────────
  await paso('Venta con Cashea', async () => {
    await api('POST', '/api/caja/abrir', { monto_inicial_usd: 50, monto_inicial_bs: 1000 });
    const cant = 6;
    const { tasas, totalUsd, refBcv, totalBs } = await armarVenta(prodId, cant);
    const desg = await api('POST', '/api/cashea/calcular', {
      totalVenta: totalUsd,
      nivelCliente: 'hoja',
      totalVentaBsBcv: totalBs,
      totalVentaUsdBcvRef: refBcv
    });
    const venta = await api('POST', '/api/ventas', {
      items: [{ producto_id: prodId, cantidad: cant }],
      total_usd: totalUsd,
      total_bs: totalBs,
      metodo_pago: 'cashea',
      pagos: [{
        metodo: 'cashea', moneda: 'USD', monto: totalUsd,
        cashea_nivel: 'hoja',
        cashea_desglose: { ...desg, totalVentaUsdBcvRef: refBcv }
      }],
      idempotency_key: `integral-cashea-${Date.now()}`
    });
    const pend = await api('GET', '/api/cashea/pendientes');
    return `${venta.numero_venta} inicial=${desg.montoInicial} prestado=${desg.montoPrestado} pendientes=${pend.resumen ? pend.resumen.total_ventas : '?'}`;
  });

  // ── 16. Compra y recepción ──────────────────────────────────────
  await paso('Compra y recepcion de mercancia', async () => {
    const prov = await api('POST', '/api/proveedores', { nombre: 'Importadora XYZ', rif: 'J-11223344-5' });
    const compra = await api('POST', '/api/compras', {
      proveedor_id: prov.id,
      tipo_pago: 'contado',
      items: [{ producto_id: prodId, cantidad: 100, costo_unitario_usd: 0.9 }]
    });
    const compraId = compra.compra ? compra.compra.id : compra.id;
    const antes = (await api('GET', `/api/productos/${prodId}`)).stock_actual;
    await api('POST', `/api/compras/${compraId}/recibir`, {});
    const prodFinal = await api('GET', `/api/productos/${prodId}`);
    return `compra=${compraId} stock ${antes} -> ${prodFinal.stock_actual} costo_prom=${prodFinal.costo_promedio_ponderado_usd}`;
  });

  // ── 17. Logout ──────────────────────────────────────────────────
  await paso('Logout', async () => {
    const r = await api('POST', '/api/auth/logout?confirm=1');
    return `ok=${r.ok !== false}`;
  });

  const fallos = resultados.filter((r) => !r.ok);
  process.stdout.write(`\n===== RESUMEN: ${resultados.length - fallos.length}/${resultados.length} pasos OK =====\n`);
  for (const f of fallos) process.stdout.write(`  FALLO: ${f.paso} -> ${f.detalle}\n`);
  process.exit(fallos.length > 0 ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`ERROR FATAL: ${e.message}\n`);
  process.exit(2);
});
