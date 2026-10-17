// auth.js reads its secrets at load time, so set them before requiring it.
process.env.INTERNAL_WORKER_SECRET = 'test-admin-key';
process.env.VIEWER_SECRET = 'test-viewer-key';

const express = require('express');
const request = require('supertest');
const { requireAuth, requireRole } = require('../middleware/auth');

const app = express();
app.use(requireAuth);
app.get('/data', (req, res) => res.json({ role: req.user.app_metadata.role }));
app.post('/data', (req, res) => res.json({ ok: true }));
app.post('/admin', requireRole(['admin', 'ai_worker']), (req, res) => res.json({ ok: true }));

const as = key => ({ Authorization: `Bearer ${key}` });

test('no token is rejected', async () => {
  await request(app).get('/data').expect(401);
});

test('viewer key can read', async () => {
  const res = await request(app).get('/data').set(as('test-viewer-key')).expect(200);
  expect(res.body.role).toBe('viewer');
});

test('viewer key cannot write anything', async () => {
  await request(app).post('/data').set(as('test-viewer-key')).expect(403);
  await request(app).post('/admin').set(as('test-viewer-key')).expect(403);
});

test('admin key can read, write and use admin routes', async () => {
  await request(app).get('/data').set(as('test-admin-key')).expect(200);
  await request(app).post('/data').set(as('test-admin-key')).expect(200);
  await request(app).post('/admin').set(as('test-admin-key')).expect(200);
});
