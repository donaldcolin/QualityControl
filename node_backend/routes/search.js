const express = require('express');
const router = express.Router();
const { lsqUrl, lsqClient } = require('../config/lsq');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    
    let leads = [];

    const trySearch = async (phoneStr) => {
      const res = await lsqClient.post(lsqUrl('LeadManagement.svc/Leads.Get'), {
        Parameter: { LookupName: "Phone", LookupValue: phoneStr, SqlType: "nvarchar" },
        Columns: { Include_CSV: "ProspectID,FirstName,LastName,Phone,Source,ProspectStage,OwnerId" },
        Paging: { PageIndex: 1, PageSize: 5 }
      }, { timeout: 10000 });
      return res.data || [];
    };

    // 1. Try exact match
    leads = await trySearch(phone);

    // 2. If no match and doesn't have +91-, try adding it
    if (leads.length === 0 && !phone.includes('+91-')) {
      const digits = phone.replace(/\D/g, '');
      const last10 = digits.slice(-10);
      if (last10.length === 10) {
        leads = await trySearch(`+91-${last10}`);
      }
    }

    // 3. Try just digits
    if (leads.length === 0) {
      leads = await trySearch(phone.replace(/\D/g, ''));
    }
    
    leads = leads.map(l => ({
      prospect_id: l.ProspectID,
      name: `${l.FirstName || ''} ${l.LastName || ''}`.trim() || 'Unknown',
      phone: l.Phone || '',
      source: l.Source || '',
      stage: l.ProspectStage || '',
      owner_id: l.OwnerId || ''
    }));

    res.json(leads);
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});
module.exports = router;
