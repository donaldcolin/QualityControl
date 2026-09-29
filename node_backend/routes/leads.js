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
  
  // 1. Fetch queues to find emp_number
  const { data: queues } = await supabase.from('callizer_queue').select('prospect_id, emp_number');
  
  // 2. Fetch associates to map emp_number to emp_name
  const { data: associates } = await supabase.from('qc_associates').select('emp_number, emp_name');
  
  const empNameMap = {};
  if (associates) {
    associates.forEach(a => {
      empNameMap[a.emp_number] = a.emp_name;
    });
  }

  const prospectOwnerMap = {};
  if (queues) {
    queues.forEach(q => {
      if (q.prospect_id && q.emp_number && empNameMap[q.emp_number]) {
        prospectOwnerMap[q.prospect_id] = empNameMap[q.emp_number];
      }
    });
  }

  const callsByProspect = {};
  if (!callsError && calls) {
    for (const c of calls) {
      if (!callsByProspect[c.prospect_id]) callsByProspect[c.prospect_id] = [];
      callsByProspect[c.prospect_id].push(c);
    }
  }

  const leadsWithCounts = (leads || []).map(l => {
    const prospectCalls = callsByProspect[l.id] || [];
    // If not found in queue, fallback to 'Unassigned'
    const resolvedOwner = prospectOwnerMap[l.id] || 'Unassigned';
    
    return {
      ...l,
      owner: resolvedOwner,
      calls: prospectCalls,
      total_calls: prospectCalls.length
    };
  });

  res.json(leadsWithCounts);
});

// Get a lead with its calls (QC) — joins evaluation_runs for full data
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

  // Fetch latest evaluation_run per call to attach insights + coaching data
  const callIds = (calls || []).map(c => c.id);
  let evalMap = {};
  if (callIds.length > 0) {
    const { data: evals } = await supabase
      .from('evaluation_runs')
      .select('call_id, results')
      .in('call_id', callIds)
      .order('created_at', { ascending: false });

    if (evals) {
      evals.forEach(e => {
        if (!evalMap[e.call_id]) evalMap[e.call_id] = e; // keep latest only
      });
    }
  }

  const enrichedCalls = (calls || []).map(c => {
    const evaluation = evalMap[c.id];
    if (evaluation && evaluation.results) {
      c.insights_data = evaluation.results.insights_data;
      c.quality_data = evaluation.results.quality_data;
      c.coaching_report = evaluation.results.coaching_report;
    }
    return c;
  });

  res.json({ ...lead, calls: enrichedCalls });
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

    const mappedActivities = allActivities
      .map(a => {
        const dataMap = {};
        (a.Data || []).forEach(d => { dataMap[d.Key] = d.Value; });
        
        // Also merge ActivityFields into dataMap so custom fields (ApplicationPaymentStatus etc.) are available
        if (a.ActivityFields) {
          Object.entries(a.ActivityFields).forEach(([k, v]) => {
            if (!dataMap[k]) dataMap[k] = v;
          });
        }

        let resourceUrl = dataMap.ResourceUrl || dataMap.ResourceURL || null;
        if (!resourceUrl) {
          const note = a.ActivityFields?.ActivityEvent_Note || '';
          const match = note.match(/(?:ResourceURL{=}|Recording Link of Demo:\s*)(https?:\/\/[^\s{]*)/i) || note.match(/(https:\/\/drive\.google\.com[^\s]+)/i);
          if (match) resourceUrl = match[1];
        }

        const duration = parseInt(dataMap.Duration || '0', 10);
        const caller = dataMap.Caller || dataMap.Reciever || '';
        
        // Determine type: prefer EventName from Data, then ActivityEvent_Name, then fallback
        let type = dataMap.EventName || a.ActivityEvent_Name || 'Activity';
        if (a.EventCode === 22) type = 'Outbound';
        if (a.EventCode === 21) type = 'Inbound';
        
        // Handle Conversion Call (BDA Activity where ActivityType = 'Conversion call')
        if (dataMap.ActivityType === 'Conversion call' || dataMap.mx_Custom_1 === 'Conversion call') {
           type = 'Conversion call';
        }
        // Google Meet Meeting (event code 216) is just auto-scheduling, NOT a confirmed demo

        const status = dataMap.CallType || dataMap.Conversioncallstatus || a.ActivityFields?.Status || 'complete';

        return {
          activity_id: a.Id,
          event_code: a.EventCode,
          type: type,
          created_on: a.CreatedOn,
          caller: caller,
          duration: duration,
          status: status,
          resource_url: resourceUrl,
          prospect_id: a.RelatedProspectId,
          data: dataMap // Include raw data for flexible UI rendering
        };
      });

    res.json(mappedActivities);
  } catch (err) {
    console.error("Activities fetch error:", err.message);
    res.json([]);
  }
});

module.exports = router;
