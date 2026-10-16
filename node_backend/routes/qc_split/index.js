const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');

const evaluations = require('./qc_evaluations');
const leads = require('./qc_leads');
const parameters = require('./qc_parameters');
const dataCapture = require('./qc_data_capture');
const activities = require('./qc_activities');
const integrations = require('./qc_integrations');
const spend = require('./qc_spend');
const { router: modeRouter } = require('./qc_mode');
const batch = require('./qc_batch');

// Enforce authentication across all QC microservice endpoints
router.use(requireAuth);

router.use(evaluations);
router.use(leads);
router.use(parameters);
router.use(dataCapture);
router.use(activities);
router.use(integrations);
router.use(spend);
router.use(modeRouter);
router.use(batch);

module.exports = router;
