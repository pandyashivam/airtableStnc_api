const express = require('express');
const authController = require('../controller/authController');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/airtable/auth-url', authController.getAirtableAuthUrl);
router.post('/airtable/callback', authController.handleAirtableCallback);

router.post('/airtable/disconnect', authMiddleware.protect, authController.disconnectAirtable);
router.get('/current-user', authMiddleware.protect, authController.getCurrentUser);

module.exports = router; 