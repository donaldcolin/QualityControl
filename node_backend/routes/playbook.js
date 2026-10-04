const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, '..', 'config');
const playbookPath = path.join(configDir, 'bd_playbook.txt');

// GET playbook
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

// PUT playbook
router.put('/', (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }
    
    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    fs.writeFileSync(playbookPath, content, 'utf8');
    res.json({ success: true, message: 'Playbook updated successfully' });
  } catch (err) {
    console.error('Error writing playbook:', err);
    res.status(500).json({ error: 'Failed to write playbook' });
  }
});

module.exports = router;
