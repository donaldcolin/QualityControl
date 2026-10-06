const express = require('express');
const router = express.Router();

const evaluations = require('./qc_evaluations');
const leads = require('./qc_leads');
const parameters = require('./qc_parameters');
const dataCapture = require('./qc_data_capture');
const activities = require('./qc_activities');
const integrations = require('./qc_integrations');

router.use(evaluations);
router.use(leads);
router.use(parameters);
router.use(dataCapture);
router.use(activities);
router.use(integrations);

module.exports = router;
