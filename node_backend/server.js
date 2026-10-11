require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { startDiskSweeperDaemon, stopDiskSweeperDaemon } = require('./services/disk_sweeper');
const { startQueueWatchdogDaemon, stopQueueWatchdogDaemon } = require('./services/queue_watchdog');

// ── PROCESS RESILIENCE & UNHANDLED ERROR INTERCEPTORS ──────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 [CRITICAL] Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 [CRITICAL] Uncaught Process Exception:', err.stack || err);
});

const app = express();

// Trust reverse proxy (Nginx) for correct client IP & protocol resolution
app.set('trust proxy', 1);

app.use(cors({
  origin: true, // allow all origins (needed for tunnel URLs + LSQ iframe)
  credentials: true
}));

// Remove X-Frame-Options so LeadSquared can embed via iframe
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});

// Configure robust body limits to prevent 413 Payload Too Large on long transcripts
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Import routes
const associatesRoutes = require('./routes/associates');
const leadsRoutes = require('./routes/leads');
const callsRoutes = require('./routes/calls');
const queueRoutes = require('./routes/queue');
const qcRoutes = require('./routes/qc_split');
const orchestratorRoutes = require('./routes/orchestrator');
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
app.use('/api/playbook', playbookRoutes);

// ── GLOBAL EXPRESS ERROR HANDLER ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('🚨 [Express Error Middleware]:', err.message || err);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  // Start 24/7 background daemons
  startDiskSweeperDaemon();
  startQueueWatchdogDaemon();
});

// ── GRACEFUL SHUTDOWN HANDLERS ────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n🛑 [Shutdown] Received ${signal}. Closing server gracefully...`);
  stopDiskSweeperDaemon();
  stopQueueWatchdogDaemon();

  server.close(() => {
    console.log('✅ [Shutdown] HTTP connections closed cleanly. Exiting process.');
    process.exit(0);
  });

  // Force shutdown if connections do not drain within 10 seconds
  setTimeout(() => {
    console.error('⚠️ [Shutdown] Forced shutdown timed out after 10s. Exiting now.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
