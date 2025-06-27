const express = require('express');
const airtableController = require('../controller/airtableController');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.protect);

router.post('/sync', airtableController.syncAllData);
router.post('/revision-history-sync', airtableController.revisionHistorySync);
router.get('/bases', airtableController.getBases);
router.get('/tables/:baseId', airtableController.getTablesByBaseId);
router.get('/model/:modelName', airtableController.getModelData);

module.exports = router; 