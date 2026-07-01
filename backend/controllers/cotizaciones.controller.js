'use strict';

const { asyncHandler, httpError } = require('../utils/asyncHandler');
const CotizacionesService = require('../services/cotizacionesService');
const PdfService = require('../services/pdfService');

async function list(req, res) {
  const { estado, cliente_id, page, limit } = req.query;
  const result = await CotizacionesService.list({
    estado:    estado   || null,
    clienteId: cliente_id ? Number(cliente_id) : null,
    page:      page     || 1,
    limit:     limit    || 50
  });
  res.json(result);
}

async function getById(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de cotización inválido');
  const cot = await CotizacionesService.getById(id);
  res.json(cot);
}

async function crear(req, res) {
  const body = req.body || {};
  const {
    cliente_id,
    fecha_vencimiento,
    iva_porcentaje,
    descuento_porcentaje,
    notas,
    lineas
  } = body;

  const usuarioId = req.user && req.user.id;

  const cot = await CotizacionesService.crear({
    clienteId:           cliente_id ? Number(cliente_id) : null,
    fechaVencimiento:    fecha_vencimiento,
    ivaPorcentaje:       Number(iva_porcentaje) || 0,
    descuentoPorcentaje: Number(descuento_porcentaje) || 0,
    notas:               notas || null,
    lineas:              lineas || [],
    usuarioId
  });

  res.status(201).json(cot);
}

async function actualizarEstado(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de cotización inválido');

  const { estado } = req.body || {};
  if (!estado) throw httpError(400, 'El campo estado es obligatorio');

  const usuarioId = req.user && req.user.id;
  const updated = await CotizacionesService.actualizarEstado(id, estado, usuarioId);
  res.json(updated);
}

async function anular(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de cotización inválido');
  const usuarioId = req.user && req.user.id;
  const updated = await CotizacionesService.anular(id, usuarioId);
  res.json(updated);
}

async function generarPdf(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de cotización inválido');

  const ctx = await CotizacionesService.fetchCotizacionPdfContext(id);
  const buf = PdfService.generateCotizacionPdfBuffer(ctx);

  const numero = ctx.cotizacion.numero || `cotizacion-${id}`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${numero}.pdf"`);
  res.send(buf);
}

module.exports = {
  list:             asyncHandler(list),
  getById:          asyncHandler(getById),
  crear:            asyncHandler(crear),
  actualizarEstado: asyncHandler(actualizarEstado),
  anular:           asyncHandler(anular),
  generarPdf:       asyncHandler(generarPdf)
};
