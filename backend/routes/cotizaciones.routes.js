'use strict';

const express = require('express');
const { requirePermission } = require('../middleware/permissions.middleware');
const ctrl = require('../controllers/cotizaciones.controller');

const router = express.Router();

router.use(requirePermission('cotizaciones_all'));

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getById);
router.post('/',             express.json({ limit: '256kb' }), ctrl.crear);
router.patch('/:id/estado',  express.json({ limit: '16kb' }),  ctrl.actualizarEstado);
router.post('/:id/anular',   ctrl.anular);
router.get('/:id/pdf',       ctrl.generarPdf);

module.exports = router;
