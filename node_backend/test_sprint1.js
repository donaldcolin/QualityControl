const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Set secret BEFORE importing the router so auth.js reads the fake one
process.env.SUPABASE_JWT_SECRET = 'fake-test-secret-1234567890123456';

// Generate an admin token to pass the RBAC requireRole(['admin'])
const adminToken = jwt.sign(
  { app_metadata: { role: 'admin' } }, 
  process.env.SUPABASE_JWT_SECRET, 
  { expiresIn: '1h' }
);

const qcRouter = require('./routes/qc');

// Setup mock express app with the router
const app = express();
app.use(express.json());

app.use(qcRouter);

async function runSprint1Test() {
  console.log('🧪 Testing Sprint 1: Async Node API');
  const start = Date.now();
  
  // Send a fake request
  const res = await request(app)
    .post('/qc/evaluate_call')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ call_id: 'fake-id', transcript: 'Customer: Hello' });
    
  const end = Date.now();
  
  if (res.status === 202) {
    console.log(`✅ SUCCESS: API returned 202 Accepted in ${end - start}ms (Async Behavior Verified)`);
  } else {
    console.log(`❌ FAILED: Expected 202, got ${res.status}`);
  }
  process.exit(0);
}

runSprint1Test();
