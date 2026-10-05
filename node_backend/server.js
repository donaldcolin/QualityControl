require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: true, // allow all origins (needed for tunnel URLs + LSQ iframe)
  credentials: true
}));
// Remove X-Frame-Options so LeadSquared can embed via iframe
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});
app.use(express.json());

// Import routes
const associatesRoutes = require('./routes/associates');
const leadsRoutes = require('./routes/leads');
const callsRoutes = require('./routes/calls');
const queueRoutes = require('./routes/queue');
const qcRoutes = require('./routes/qc');
const orchestratorRoutes = require('./routes/orchestrator');
const parametersRoutes = require('./routes/parameters');
const driveRoutes = require('./routes/drive');
const playbookRoutes = require('./routes/playbook');

// Mount prefixed routes
app.use('/api/associates', associatesRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/search', require('./routes/search'));
app.use('/api/calls', callsRoutes);
app.use('/api/orchestrate', orchestratorRoutes);
app.use('/api/drive', driveRoutes);

// Mount non-prefixed routes (the routes themselves have the prefix like /queue, /qc, /coaching inside)
app.use('/api', queueRoutes);
app.use('/api', qcRoutes);
app.use('/api', parametersRoutes);
app.use('/api/playbook', playbookRoutes);



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Automate Google Meet Transcript Sync (Run every 15 minutes)
  const meetSync = require('./services/meet_sync');
  setInterval(async () => {
    try {
      console.log(`[Auto-Sync] Running background Google Meet transcript sync...`);
      await meetSync.triggerManualSync();
    } catch (err) {
      console.error(`[Auto-Sync] Meet sync failed:`, err.message);
    }
  }, 15 * 60 * 1000); // 15 minutes
});
