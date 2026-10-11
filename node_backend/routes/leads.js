const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase');
const { lsqUrl } = require('../config/lsq');
const { getActivitiesForLead } = require('../services/lead_service');
const { requireAuth } = require('../middleware/auth');
const { fetchInChunks } = require('../utils/db_utils');

// Enforce authentication on all leads routes
router.use(requireAuth);

// Get all leads (QC) with server-side pagination
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = (page - 1) * limit;

  const { data: leads, error, count } = await supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });

  if (!leads || leads.length === 0) {
    res.set({
      'X-Total-Count': count || 0,
      'X-Page': page,
      'X-Limit': limit
    });
    return res.json([]);
  }

  const leadIds = leads.map(l => l.id);

  // 1. Fetch calls ONLY for these paginated leads (chunked to prevent HTTP 414)
  const calls = await fetchInChunks(leadIds, 50, async (chunk) => {
    const { data, error } = await supabase
      .from('calls')
      .select('id, prospect_id, qc_status, duration_sec, call_quality_score, talk_to_listen_ratio, insights_data, quality_data')
      .in('prospect_id', chunk);
    if (error) console.error("Error fetching calls chunk:", error.message);
    return data || [];
  });

  // 2. Fetch queues to find emp_number ONLY for these leads (chunked)
  const queues = await fetchInChunks(leadIds, 50, async (chunk) => {
    const { data, error } = await supabase
      .from('callizer_queue')
      .select('prospect_id, emp_number')
      .in('prospect_id', chunk);
    if (error) console.error("Error fetching queues chunk:", error.message);
    return data || [];
  });
  
  // 3. Fetch associates to map emp_number to emp_name
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
  if (calls) {
    for (const c of calls) {
      if (!callsByProspect[c.prospect_id]) callsByProspect[c.prospect_id] = [];
      callsByProspect[c.prospect_id].push(c);
    }
    Object.values(callsByProspect).forEach(prospectCalls => {
      prospectCalls.sort((a, b) => {
        if (a.call_date && b.call_date) {
          return new Date(a.call_date).getTime() - new Date(b.call_date).getTime();
        }
        if (a.call_date) return -1;
        if (b.call_date) return 1;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    });
  }

  const leadsWithCounts = leads.map(l => {
    const prospectCalls = callsByProspect[l.id] || [];
    // Use owner from database if valid, else fallback to queue mapper, else 'Unassigned'
    const resolvedOwner = (l.owner && l.owner !== 'Unassigned') 
      ? l.owner 
      : (prospectOwnerMap[l.id] || 'Unassigned');
    
    return {
      ...l,
      owner: resolvedOwner,
      calls: prospectCalls,
      total_calls: prospectCalls.length
    };
  });

  res.set({
    'X-Total-Count': count || leadsWithCounts.length,
    'X-Page': page,
    'X-Limit': limit
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

  let { data: calls, error: callsError } = await supabase
    .from('calls')
    .select('*')
    .eq('prospect_id', req.params.id)
    .order('call_date', { ascending: true, nullsFirst: false });

  if (callsError && callsError.message && callsError.message.includes('call_date')) {
    const fallback = await supabase
      .from('calls')
      .select('*')
      .eq('prospect_id', req.params.id)
      .order('id', { ascending: true });
    calls = fallback.data;
    callsError = fallback.error;
  }

  if (callsError) return res.status(500).json({ error: callsError.message });

  if (calls) {
    calls.sort((a, b) => {
      if (a.call_date && b.call_date) {
        return new Date(a.call_date).getTime() - new Date(b.call_date).getTime();
      }
      if (a.call_date) return -1;
      if (b.call_date) return 1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  // Fetch latest evaluation_run per call to attach insights + coaching data (chunked)
  const callIds = (calls || []).map(c => c.id);
  let evalMap = {};
  if (callIds.length > 0) {
    const evals = await fetchInChunks(callIds, 50, async (chunk) => {
      const { data, error } = await supabase
        .from('evaluation_runs')
        .select('call_id, results, created_at')
        .in('call_id', chunk)
        .order('created_at', { ascending: false });
      if (error) console.error("Error fetching evals chunk:", error.message);
      return data || [];
    });

    if (evals) {
      evals.forEach(e => {
        if (!evalMap[e.call_id]) evalMap[e.call_id] = e; // keep latest only
      });
    }
  }

  const enrichedCalls = (calls || []).map(c => {
    const evaluation = evalMap[c.id];
    
    // Resolve visual timeline
    let visualTimeline = null;
    if (evaluation?.results?.visual_timeline) {
      visualTimeline = evaluation.results.visual_timeline;
    } else if (c.insights_data?.visual_timeline) {
      visualTimeline = c.insights_data.visual_timeline;
    }

    if (evaluation && evaluation.results) {
      c.insights_data = evaluation.results.insights_data;
      c.quality_data = evaluation.results.quality_data;
      c.coaching_report = evaluation.results.coaching_report;
      c.summary_data = evaluation.results.summary_data;
      c.qc_results = evaluation.results.qc_results;
      // Also enrich score fields from evaluation_runs so frontend gets latest data
      if (evaluation.results.call_quality_score != null) {
        c.call_quality_score = evaluation.results.call_quality_score;
      }
      if (evaluation.results.call_quality_raw != null) {
        c.call_quality_raw = evaluation.results.call_quality_raw;
      }
    }
    
    c.visual_timeline = visualTimeline;
    return c;
  });

  res.json({ ...lead, calls: enrichedCalls });
});

// Get phone call activities (Inbound=21, Outbound=22) for a lead from LSQ
router.get('/:prospect_id/activities', async (req, res) => {
  try {
    const mappedActivities = await getActivitiesForLead(req.params.prospect_id);
    res.json(mappedActivities);
  } catch (err) {
    console.error("Activities fetch error:", err.message);
    res.json([]);
  }
});

module.exports = router;
