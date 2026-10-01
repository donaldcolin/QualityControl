require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
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



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
