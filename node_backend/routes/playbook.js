const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { requireAuth, requireRole } = require('../middleware/auth');

const configDir = path.join(__dirname, '..', 'config');
const playbookPath = path.join(configDir, 'bd_playbook.txt');
const historyDir = path.join(configDir, 'playbook_history');

// Enforce authentication across all playbook endpoints
router.use(requireAuth);

// GET active playbook
router.get('/', (req, res) => {
  try {
    if (!fs.existsSync(playbookPath)) {
      return res.status(200).json({ content: '' });
    }
    const content = fs.readFileSync(playbookPath, 'utf8');
    res.json({ content });
  } catch (err) {
    console.error('Error reading playbook:', err);
    res.status(500).json({ error: 'Failed to read playbook' });
  }
});

// GET playbook backup history
router.get('/history', (req, res) => {
  try {
    if (!fs.existsSync(historyDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(historyDir)
      .filter(f => f.startsWith('bd_playbook_') && f.endsWith('.txt'))
      .map(filename => {
        const filePath = path.join(historyDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          size: stats.size,
          created_at: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(files);
  } catch (err) {
    console.error('Error reading playbook history:', err);
    res.status(500).json({ error: 'Failed to read playbook history' });
  }
});

// PUT update playbook with automated backup (Admin or AI Worker only)
router.put('/', requireRole(['admin', 'ai_worker']), (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }
    
    // Ensure config & history directories exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    // 1. If an existing playbook exists and is non-empty, create a timestamped backup
    if (fs.existsSync(playbookPath)) {
      const existingContent = fs.readFileSync(playbookPath, 'utf8');
      if (existingContent.trim().length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(historyDir, `bd_playbook_${timestamp}.txt`);
        fs.writeFileSync(backupPath, existingContent, 'utf8');
        console.log(`💾 [Playbook Backup] Saved backup to ${backupPath}`);
      }
    }

    // 2. Safely write new playbook
    fs.writeFileSync(playbookPath, content, 'utf8');

    // 3. Hot-reload in-memory qcEngine if loaded
    try {
      const qcEngine = require('../services/qc_engine');
      if (qcEngine) {
        qcEngine.bdPlaybook = content;
        console.log('🔄 [Playbook] Hot-reloaded in-memory qcEngine playbook.');
      }
    } catch (reloadErr) {
      // Non-fatal if qcEngine is not initialized yet
    }

    res.json({ success: true, message: 'Playbook updated and backed up successfully' });
  } catch (err) {
    console.error('Error writing playbook:', err);
    res.status(500).json({ error: 'Failed to write playbook' });
  }
});

// POST rollback to a previous version (Admin only)
router.post('/rollback/:filename', requireRole(['admin']), (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (!filename.startsWith('bd_playbook_') || !filename.endsWith('.txt') || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid rollback target filename' });
    }

    const targetPath = path.join(historyDir, filename);

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Version not found in history' });
    }

    const previousContent = fs.readFileSync(targetPath, 'utf8');

    // Backup current before rollback
    if (fs.existsSync(playbookPath)) {
      const currentContent = fs.readFileSync(playbookPath, 'utf8');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(historyDir, `bd_playbook_${timestamp}_prerollback.txt`), currentContent, 'utf8');
    }

    fs.writeFileSync(playbookPath, previousContent, 'utf8');

    try {
      const qcEngine = require('../services/qc_engine');
      if (qcEngine) qcEngine.bdPlaybook = previousContent;
    } catch (e) {}

    res.json({ success: true, message: `Successfully rolled back to ${filename}` });
  } catch (err) {
    console.error('Error rolling back playbook:', err);
    res.status(500).json({ error: 'Failed to rollback playbook' });
  }
});

module.exports = router;
