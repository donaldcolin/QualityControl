const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { lsqUrl } = require('../config/lsq');

const lsqClient = axios.create({
  timeout: 10000 // 10-second hard circuit breaker timeout
});

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
  lead_source
}) {
  if (!resource_url) {
    const err = new Error("No recording URL available for this activity");
    err.statusCode = 400;
    throw err;
  }

  // Upsert lead so it's immediately tracked on the QC Leads Dashboard
  if (prospect_id) {
    let resolvedOwnerName = 'Unassigned';
    if (emp_number) {
      const { data: assoc } = await supabase
        .from('qc_associates')
        .select('emp_name')
        .eq('emp_number', emp_number)
        .maybeSingle();
      if (assoc && assoc.emp_name) resolvedOwnerName = assoc.emp_name;
    }

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

  const { error: insertErr } = await supabase.from('callizer_queue').insert({
    id: queue_id,
    call_id: activity_id,
    audio_url: resource_url,
    language: language || 'hi',
    status: 'pending',
    emp_number: emp_number || '',
    client_number: client_number || '',
    call_type: type || '',
    duration: parseFloat(duration) || 0,
    prospect_id: prospect_id || '',
    errors: '[]'
  });

  if (insertErr) throw insertErr;

  return { status: "queued", queue_id };
}

module.exports = {
  getLeadsForAssociate,
  getActivitiesForLead,
  pushActivityToQCQueue
};
