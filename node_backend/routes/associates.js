const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase');
const { lsqParams, lsqUrl } = require('../config/lsq');
const { getLeadsForAssociate } = require('../services/lead_service');
const { requireAuth, requireRole } = require('../middleware/auth');

// Enforce authentication across all associate management routes
router.use(requireAuth);

// Sync all LSQ users (sales reps) so user can pick who to track
router.get('/sync', async (req, res) => {
  try {
    const { accessKey, secretKey } = lsqParams();
    if (!accessKey || !secretKey) {
      return res.status(400).json({ error: "LeadSquared API keys not set in .env" });
    }

    const lsqRes = await axios.get(lsqUrl('UserManagement.svc/Users.Get'), { timeout: 10000 });

    let data = [];
    if (lsqRes.data && Array.isArray(lsqRes.data)) {
      data = lsqRes.data
        .filter(user => user.StatusCode === 0)
        .map(user => ({
          emp_number: user.ID,
          emp_name: `${user.FirstName || ''} ${user.LastName || ''}`.trim() || user.EmailAddress || 'Unknown User',
          emp_tags: [user.Role, ...(user.MemberOfGroups || [])].filter(Boolean).join(', ')
        }));
    }

    res.json({ status: "ok", data });
  } catch (err) {
    console.error("Sync error:", err.message);
    res.status(500).json({ error: "Failed to fetch from LeadSquared" });
  }
});

// Get tracked associates from local DB
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('qc_associates').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Add associate to tracking (Admin or AI Worker only)
router.post('/', requireRole(['admin', 'ai_worker']), async (req, res) => {
  const { emp_number, emp_name, emp_tags, language } = req.body;
  if (!emp_number || !emp_name) {
    return res.status(400).json({ error: "emp_number and emp_name are required" });
  }
  let finalTags = emp_tags || '';
  if (language) {
    finalTags = finalTags ? `${finalTags}, |lang:${language}` : `|lang:${language}`;
  }
  const { data, error } = await supabase.from('qc_associates').insert([{ emp_number, emp_name, emp_tags: finalTags }]);
  if (error) {
    if (error.code === '23505') return res.status(400).json({ error: "Associate already exists" });
    return res.status(500).json({ error: error.message });
  }
  res.json({ status: "ok" });
});

// Remove associate from tracking (Admin or AI Worker only)
router.delete('/:emp_number', requireRole(['admin', 'ai_worker']), async (req, res) => {
  const { error } = await supabase.from('qc_associates').delete().eq('emp_number', req.params.emp_number);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: "ok" });
});

// Get leads owned by a specific user, filtered by ProspectStage = "New Lead"
router.get('/:user_id/leads', async (req, res) => {
  try {
    const userId = req.params.user_id;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;

    const leads = await getLeadsForAssociate(userId, page, pageSize);
    res.json(leads);
  } catch (err) {
    console.error("Leads fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch leads from LeadSquared" });
  }
});

// Get associate calls (legacy)
router.get('/:emp_number/calls', async (req, res) => {
  const { data, error } = await supabase
    .from('callizer_queue')
    .select('*')
    .eq('emp_number', req.params.emp_number)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
