const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { lsqUrl, lsqClient } = require('../config/lsq');

/**
 * Fetch leads owned by a specific sales associate from LeadSquared.
 */
async function getLeadsForAssociate(userId, page = 1, pageSize = 50) {
  const lsqRes = await lsqClient.post(lsqUrl('LeadManagement.svc/Leads.Get'), {
    Parameter: { LookupName: "OwnerId", LookupValue: userId, SqlType: "uniqueidentifier" },
    Columns: { Include_CSV: "ProspectID,FirstName,LastName,Phone,Source,ProspectStage,OwnerId" },
    Paging: { PageIndex: page, PageSize: pageSize }
  });

  let leads = (lsqRes.data || []).filter(l => l.ProspectStage === 'New Lead');

  return leads.map(l => ({
    prospect_id: l.ProspectID,
    name: `${l.FirstName || ''} ${l.LastName || ''}`.trim() || 'Unknown',
    phone: l.Phone || '',
    source: l.Source || '',
    stage: l.ProspectStage || ''
  }));
}

/**
 * Fetch phone call and meeting activities for a prospect from LeadSquared.
 */
async function getActivitiesForLead(prospectId) {
  const actRes = await lsqClient.post(
    lsqUrl('ProspectActivity.svc/Retrieve') + `&leadId=${encodeURIComponent(prospectId)}`,
    { Paging: { Offset: "0", RowCount: "200" } }
  );

  const allActivities = actRes.data?.ProspectActivities || [];

  return allActivities
    .map(a => {
      const dataMap = {};
      (a.Data || []).forEach(d => { dataMap[d.Key] = d.Value; });

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

      let type = dataMap.EventName || a.ActivityEvent_Name || 'Activity';
      if (a.EventCode === 22) type = 'Outbound';
      if (a.EventCode === 21) type = 'Inbound';

      const activityTypeLower = String(dataMap.ActivityType || dataMap.mx_Custom_1 || dataMap['1'] || '').toLowerCase();
      if (activityTypeLower === 'conversion call') {
        type = 'Conversion call';
      } else if (activityTypeLower === 'demo conducted') {
        type = 'Demo Conducted';
      }

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
        data: dataMap
      };
    })
    .filter(a => {
      if (!a) return false;
      const t = (a.type || '').toLowerCase();

      // Attended calls only
      if (t === 'inbound' || t === 'outbound') {
        const stat = (a.status || '').toLowerCase();
        return stat === 'complete' || stat === 'answered';
      }

      // Meetings (keep them whether they have recordings or not)
      if (t === 'conversion call' || t === 'demo conducted') {
        return true;
      }

      // Application Status
      if (t === 'application status') {
        return true;
      }

      return false;
    });
}

/**
 * Pushes an activity/call into callizer_queue and ensures the lead is tracked in leads table.
 */
async function pushActivityToQCQueue({
  activity_id,
  resource_url,
  duration,
  type,
  prospect_id,
  emp_number,
  client_number,
  language = 'hi',
  lead_name,
  lead_source,
  call_date
}) {
  if (!resource_url) {
    const err = new Error("No recording URL available for this activity");
    err.statusCode = 400;
    throw err;
  }

  // Upsert lead so it's immediately tracked on the QC Leads Dashboard
  let resolvedOwnerName = 'Unassigned';
  let resolvedLang = language;
  if (emp_number) {
    const { data: assoc } = await supabase
      .from('qc_associates')
      .select('emp_name, emp_tags')
      .eq('emp_number', emp_number)
      .maybeSingle();
    if (assoc && assoc.emp_name) resolvedOwnerName = assoc.emp_name;
    if (assoc && assoc.emp_tags) {
      const match = assoc.emp_tags.match(/\|lang:([a-z]{2})/i);
      if (match) {
        if (!resolvedLang || resolvedLang === 'hi') {
          resolvedLang = match[1].toLowerCase();
        }
      }
    }
  }
  if (!resolvedLang) resolvedLang = 'hi';

  if (prospect_id) {
    await supabase.from('leads').upsert({
      id: prospect_id,
      name: lead_name || 'Unknown',
      phone: client_number || null,
      lead_source: lead_source || 'Phone',
      owner: resolvedOwnerName
    }, { onConflict: 'id', ignoreDuplicates: true });
  }

  const { data: existing } = await supabase
    .from('callizer_queue')
    .select('id, status')
    .eq('call_id', activity_id)
    .maybeSingle();

  if (existing) {
    const err = new Error(`Already queued (status: ${existing.status})`);
    err.statusCode = 400;
    err.isAlreadyQueued = true;
    err.queue_id = existing.id;
    throw err;
  }

  const queue_id = uuidv4();

  // Route through the intake governor for proper priority, dedup, gating, and killswitch
  try {
    const { governAndIngestCall } = require('./queue_governor/intake_governor');
    const ingestRes = await governAndIngestCall({
      source: 'phone_call',
      callId: activity_id,
      audioUrl: resource_url,
      durationSec: parseFloat(duration) || 0,
      callType: type || 'Outbound',
      prospectId: prospect_id || '',
      language: resolvedLang,
      empNumber: emp_number || '',
      clientNumber: client_number || '',
      callDate: call_date
    });

    if (!ingestRes.admitted) {
      return { 
        status: ingestRes.status, 
        reason: ingestRes.reason,
        queue_id: ingestRes.queueId || null
      };
    }

    return { status: "queued", queue_id: ingestRes.queueId };
  } catch (govErr) {
    // Fallback: direct insert if governor fails (keeps system resilient)
    console.warn(`[LeadService] Governor fallback for ${activity_id}: ${govErr.message}`);
    const queuePayload = {
      id: queue_id,
      call_id: activity_id,
      audio_url: resource_url,
      language: resolvedLang,
      status: 'pending',
      priority: 2,
      source_type: 'phone_call',
      is_gated_admitted: true,
      emp_number: emp_number || '',
      client_number: client_number || '',
      call_type: type || '',
      duration: parseFloat(duration) || 0,
      prospect_id: prospect_id || '',
      errors: '[]'
    };

    if (call_date) {
      try {
        queuePayload.call_date = new Date(call_date).toISOString();
      } catch (e) {
        console.warn("Invalid call_date format:", call_date);
      }
    }

    let { error: insertErr } = await supabase.from('callizer_queue').insert(queuePayload);
    if (insertErr && insertErr.message && insertErr.message.includes('call_date')) {
      console.warn("⚠️ [Queue] 'call_date' column missing in callizer_queue. Retrying without call_date.");
      delete queuePayload.call_date;
      const retry = await supabase.from('callizer_queue').insert(queuePayload);
      insertErr = retry.error;
    }

    if (insertErr) throw insertErr;

    return { status: "queued", queue_id };
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * LSQ call with jittered exponential backoff on HTTP 429.
 */
async function withBackoff(fn, retries = 4) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.response?.status !== 429 || attempt >= retries) throw err;
      await sleep(500 * 2 ** attempt + Math.random() * 250);
    }
  }
}

/**
 * Leads modified after `minModifiedOn` (LSQ UTC "yyyy-MM-dd HH:mm:ss"), OLDEST first,
 * so a watermark advanced past the last processed lead never skips unprocessed ones.
 */
async function getRecentActiveLeads(page = 1, pageSize = 20, minModifiedOn = null) {
  const payload = {
    Columns: { Include_CSV: "ProspectID,FirstName,LastName,Phone,Source,ProspectStage,OwnerId,ModifiedOn,CreatedOn" },
    Sorting: { ColumnName: "ModifiedOn", Direction: "0" },
    Paging: { PageIndex: page, PageSize: pageSize }
  };
  if (minModifiedOn) {
    payload.Parameter = { LookupName: "ModifiedOn", LookupValue: minModifiedOn, SqlOperator: ">" };
  }
  const lsqRes = await withBackoff(() => lsqClient.post(lsqUrl('LeadManagement.svc/Leads.Get'), payload));
  return (lsqRes.data || []).map(l => ({
    prospect_id: l.ProspectID,
    name: `${l.FirstName || ''} ${l.LastName || ''}`.trim() || 'Unknown',
    phone: l.Phone || '',
    source: l.Source || 'Phone',
    stage: l.ProspectStage || '',
    owner_id: l.OwnerId || '',
    modified_on: l.ModifiedOn,
    created_on: l.CreatedOn
  }));
}

/**
 * Team-only discovery: leads modified after `since` whose owner is in qc_associates.
 * LSQ can't filter by a list of owners, so pages of 100 are filtered here; non-team leads cost nothing more.
 * `scannedUpTo` is the ModifiedOn of the last lead examined, i.e. where the next scan can safely resume.
 */
async function getTeamLeadsSince(since, wanted, maxFetches = 5) {
  const { data: assocs, error } = await supabase.from('qc_associates').select('emp_number');
  if (error) throw error;
  const team = new Set((assocs || []).map(a => String(a.emp_number).toLowerCase()));

  const leads = [];
  let scannedUpTo = since;
  for (let i = 0; i < maxFetches && leads.length < wanted; i++) {
    const page = await getRecentActiveLeads(1, 100, scannedUpTo);
    for (const l of page) {
      scannedUpTo = l.modified_on || scannedUpTo;
      if (team.has(String(l.owner_id).toLowerCase())) leads.push(l);
      if (leads.length >= wanted) break;
    }
    if (page.length < 100) break; // caught up with LSQ
  }
  return { leads, scannedUpTo };
}

function loopbackConfig(timeout) {
  const token = process.env.INTERNAL_WORKER_SECRET;
  return { timeout, headers: token ? { Authorization: `Bearer ${token}` } : {} };
}

/**
 * Pulls every qualifying phone call and the video demo of one lead into the QC queue,
 * oldest first, with a single batched dedup query.
 */
async function syncSingleLeadEntirely(leadData) {
  const prospectId = leadData.prospect_id;
  if (!prospectId) throw new Error('prospect_id is required');

  let ownerName = 'Unassigned';
  let lang = 'hi';
  const ownerId = leadData.owner_id;
  if (ownerId) {
    const { data: assoc } = await supabase
      .from('qc_associates')
      .select('emp_name, emp_tags')
      .eq('emp_number', ownerId)
      .maybeSingle();
    if (assoc?.emp_name) ownerName = assoc.emp_name;
    const m = assoc?.emp_tags?.match(/\|lang:([a-z]{2})/i);
    if (m) lang = m[1].toLowerCase();
  }

  await supabase.from('leads').upsert({
    id: prospectId,
    name: leadData.name || 'Unknown',
    phone: leadData.phone || null,
    lead_source: leadData.source || 'Phone',
    owner: ownerName
  }, { onConflict: 'id', ignoreDuplicates: true });

  const activities = await withBackoff(() => getActivitiesForLead(prospectId));
  const result = {
    prospect_id: prospectId, name: leadData.name, owner: ownerName, language: lang,
    total_activities: activities.length, calls_queued: 0, calls_skipped: 0, demos_queued: 0, demos_skipped: 0
  };
  if (!activities.length) return result;

  const ids = activities.map(a => a.activity_id).filter(Boolean);
  const { data: existingRows } = await supabase.from('callizer_queue').select('call_id').in('call_id', ids);
  const existing = new Set((existingRows || []).map(r => r.call_id));

  // Queue rows can be cleared, so also treat anything already transcribed into `calls` as done.
  const urls = activities.map(a => a.resource_url).filter(Boolean);
  const { data: doneCalls } = await supabase
    .from('calls')
    .select('audio_url, source')
    .eq('prospect_id', prospectId);
  const doneUrls = new Set((doneCalls || []).map(c => c.audio_url).filter(u => urls.includes(u)));
  const demoAlreadyDone = (doneCalls || []).some(c => c.source === 'google_meet');

  activities.sort((a, b) => new Date(a.created_on || 0) - new Date(b.created_on || 0));

  let demoDone = demoAlreadyDone;
  for (const act of activities) {
    const t = (act.type || '').toLowerCase();

    if (t === 'inbound' || t === 'outbound') {
      if (!act.resource_url || act.duration <= 60) continue;
      if (existing.has(act.activity_id) || doneUrls.has(act.resource_url)) { result.calls_skipped++; continue; }
      try {
        const r = await pushActivityToQCQueue({
          activity_id: act.activity_id,
          resource_url: act.resource_url,
          duration: act.duration,
          type: act.type,
          prospect_id: prospectId,
          emp_number: ownerId,
          client_number: leadData.phone || '',
          language: lang,
          lead_name: leadData.name,
          lead_source: leadData.source,
          call_date: act.created_on
        });
        if (r?.status === 'queued') result.calls_queued++; else result.calls_skipped++;
      } catch (err) {
        if (!err.isAlreadyQueued) console.warn(`[LeadService] Push failed ${act.activity_id}: ${err.message}`);
        result.calls_skipped++;
      }
    } else if ((t === 'conversion call' || t === 'demo conducted') && !demoDone) {
      demoDone = true; // Drive lookup is per lead, so one attempt covers all demo activities
      try {
        let link = act.resource_url;
        if (!link && (leadData.phone || leadData.name)) {
          const params = new URLSearchParams();
          if (leadData.phone) params.append('phone', leadData.phone);
          if (leadData.name) params.append('name', leadData.name);
          const port = process.env.PORT || 3000;
          const d = await axios.get(`http://localhost:${port}/api/drive/recording?${params}`, loopbackConfig(15000))
            .catch(() => null);
          link = d?.data?.webViewLink;
        }
        if (!link) continue;
        const port = process.env.PORT || 3000;
        const q = await axios.post(`http://localhost:${port}/api/upload_drive_demo`,
          { drive_link: link, language: lang, prospect_id: prospectId }, loopbackConfig(15000));
        if (q.data?.queue_id) result.demos_queued++;
      } catch (err) {
        result.demos_skipped++; // 409 duplicate or Drive failure: non-fatal
      }
    }
  }
  return result;
}

module.exports = {
  getLeadsForAssociate,
  getActivitiesForLead,
  pushActivityToQCQueue,
  getRecentActiveLeads,
  getTeamLeadsSince,
  syncSingleLeadEntirely
};
