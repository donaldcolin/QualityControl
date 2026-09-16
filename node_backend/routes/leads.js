const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase');
const { lsqUrl } = require('../config/lsq');

// Get all leads (QC)
router.get('/', async (req, res) => {
  const { data: leads, error } = await supabase.from('leads').select('*').order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  
  const { data: calls, error: callsError } = await supabase.from('calls').select('id, prospect_id, created_at').order('created_at', { ascending: true });
  
  const callsByProspect = {};
  if (!callsError && calls) {
    for (const c of calls) {
      if (!callsByProspect[c.prospect_id]) callsByProspect[c.prospect_id] = [];
      callsByProspect[c.prospect_id].push(c);
    }
  }

  const leadsWithCounts = (leads || []).map(l => {
    const prospectCalls = callsByProspect[l.id] || [];
    return {
      ...l,
      calls: prospectCalls,
      total_calls: prospectCalls.length
    };
  });
  
  res.json(leadsWithCounts);
});

// Get a lead with its calls (QC)
router.get('/:id', async (req, res) => {
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (leadError) return res.status(500).json({ error: leadError.message });

  const { data: calls, error: callsError } = await supabase
    .from('calls')
    .select('*')
    .eq('prospect_id', req.params.id)
    .order('id', { ascending: true });

  if (callsError) return res.status(500).json({ error: callsError.message });

  res.json({ ...lead, calls });
});

// Get phone call activities (Inbound=21, Outbound=22) for a lead from LSQ
router.get('/:prospect_id/activities', async (req, res) => {
  try {
    const prospectId = req.params.prospect_id;

    const actRes = await axios.post(
      lsqUrl('ProspectActivity.svc/Retrieve') + `&leadId=${prospectId}`,
      { Paging: { Offset: "0", RowCount: "200" } }
    );

    const allActivities = actRes.data?.ProspectActivities || [];

    const phoneActivities = allActivities
      .filter(a => a.EventCode === 21 || a.EventCode === 22)
      .map(a => {
        const dataMap = {};
        (a.Data || []).forEach(d => { dataMap[d.Key] = d.Value; });

        let resourceUrl = dataMap.ResourceUrl || dataMap.ResourceURL || null;
        if (!resourceUrl) {
          const note = a.ActivityFields?.ActivityEvent_Note || '';
          const match = note.match(/ResourceURL{=}(https?:\/\/[^\s{]*)/);
          if (match) resourceUrl = match[1];
        }

        const duration = parseInt(dataMap.Duration || '0', 10);
        const caller = dataMap.Caller || dataMap.Reciever || '';
        const status = dataMap.CallType || a.ActivityFields?.Status || '';

        return {
          activity_id: a.Id,
          event_code: a.EventCode,
          type: a.EventCode === 22 ? 'Outbound' : 'Inbound',
          created_on: a.CreatedOn,
          caller: caller,
          duration: duration,
          status: status,
          resource_url: resourceUrl,
          prospect_id: a.RelatedProspectId
        };
      });

    res.json(phoneActivities);
  } catch (err) {
    console.error("Activities fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch activities from LeadSquared" });
  }
});

module.exports = router;
