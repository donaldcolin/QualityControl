const API_BASE = '/api';

export const startRun = async (folder_path, language) => {
  const res = await fetch(`${API_BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_path, language })
  });
  return res.json();
};

export const startUploadRun = async (files, language) => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  formData.append('language', language);

  const res = await fetch(`${API_BASE}/upload_run`, {
    method: 'POST',
    body: formData
  });
  return res.json();
};

export const getRunStatus = async (batchId) => {
  const res = await fetch(`${API_BASE}/runs/${batchId}/status`);
  return res.json();
};

export const getCalls = async () => {
  const res = await fetch(`${API_BASE}/calls`);
  return res.json();
};

export const getCall = async (callId) => {
  const res = await fetch(`${API_BASE}/calls/${callId}`);
  return res.json();
};

export const rateCall = async (callId, rating, notes) => {
  const res = await fetch(`${API_BASE}/calls/${callId}/rating`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, notes })
  });
  return res.json();
};

export const getAssociates = async () => {
  const res = await fetch(`${API_BASE}/associates`);
  return res.json();
};

export const syncAssociates = async () => {
  const res = await fetch(`${API_BASE}/associates/sync`);
  return res.json();
};

export const addAssociate = async (emp_number, emp_name, emp_tags, language) => {
  const res = await fetch(`${API_BASE}/associates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_number, emp_name, emp_tags, language })
  });
  return res.json();
};

export const removeAssociate = async (emp_number) => {
  const res = await fetch(`${API_BASE}/associates/${emp_number}`, {
    method: 'DELETE'
  });
  return res.json();
};

export const getAssociateCalls = async (emp_number) => {
  const res = await fetch(`${API_BASE}/associates/${emp_number}/calls`);
  return res.json();
};

export const sendToQC = async (queueId) => {
  const res = await fetch(`${API_BASE}/queue/${queueId}/send_to_qc`, {
    method: 'POST'
  });
  return res.json();
};

// --- NEW: LeadSquared 3-level drill-down ---

export const getLeadsForAssociate = async (userId) => {
  const res = await fetch(`${API_BASE}/associates/${userId}/leads`);
  return res.json();
};

export const getActivitiesForLead = async (prospectId) => {
  const res = await fetch(`${API_BASE}/leads/${prospectId}/activities`);
  return res.json();
};

export const getQueue = async () => {
  const res = await fetch(`${API_BASE}/queue`);
  return res.json();
};

export const pushActivityToQC = async (activityData) => {
  const res = await fetch(`${API_BASE}/activities/push_to_qc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(activityData)
  });
  return res.json();
};

export const getQueueItemStatus = async (queueId) => {
  const res = await fetch(`${API_BASE}/queue/${queueId}`);
  return res.json();
};

export async function deleteQueueItem(id) {
  const res = await fetch(`${API_BASE}/queue/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function bumpQueueItem(id) {
  const res = await fetch(`${API_BASE}/queue/${id}/bump`, { method: 'POST' });
  return res.json();
}

// --- NEW: Quality Control (QC) Microservice ---
const QC_API_BASE = '/api';

export const triggerMeetSync = async () => {
  const res = await fetch(`${API_BASE}/meet_sync/trigger`, { method: 'POST' });
  return res.json();
};

export const getQCLeads = async () => {
  const res = await fetch(`${QC_API_BASE}/leads`);
  return res.json();
};

export const getQCLead = async (id) => {
  const res = await fetch(`${QC_API_BASE}/leads/${id}`);
  return res.json();
};

export const evaluateCall = async (call_id) => {
  const res = await fetch(`${QC_API_BASE}/qc/evaluate_call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_id })
  });
  return res.json();
};

export const evaluateLeadIntelligence = async (lead_id) => {
  const res = await fetch(`${QC_API_BASE}/intelligence/evaluate_lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lead_id })
  });
  return res.json();
};

export const seedQCDemo = async () => {
  const res = await fetch(`${QC_API_BASE}/demo/seed`, { method: 'POST' });
  return res.json();
};

// --- Orchestrator ---

export const resendCallToASR = async (callId) => {
  const res = await fetch(`${API_BASE}/calls/${callId}/send_to_asr`, { method: 'POST' });
  return res.json();
};

export const scanAll = async () => {
  const res = await fetch(`${API_BASE}/orchestrate/scan_all`, { method: 'POST' });
  return res.json();
};

// --- Coaching LSQ Push ---
export const pushCoachingToLSQ = async (prospect_id, coaching_report, source) => {
  const res = await fetch(`${API_BASE}/coaching/push_to_lsq`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prospect_id, coaching_report, source })
  });
  return res.json();
};

// --- Dynamic Parameters (Lead-Centric Architecture) ---

export const getQCParameters = async (source = 'phone_call') => {
  const res = await fetch(`${QC_API_BASE}/quality_checks?source=${source}`);
  return res.json();
};

export const createQCParameter = async (data) => {
  const res = await fetch(`${QC_API_BASE}/quality_checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
};

export const updateQCParameter = async (id, data) => {
  const res = await fetch(`${QC_API_BASE}/quality_checks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
};

export const deleteQCParameter = async (id) => {
  const res = await fetch(`${QC_API_BASE}/quality_checks/${id}`, { method: 'DELETE' });
  return res.ok;
};

export const getDataCaptureQuestions = async (source = 'phone_call') => {
  const res = await fetch(`${QC_API_BASE}/data_capture_questions?source=${source}`);
  return res.json();
};

export const createDataCaptureQuestion = async (data) => {
  const res = await fetch(`${QC_API_BASE}/data_capture_questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
};

export const updateDataCaptureQuestion = async (id, data) => {
  const res = await fetch(`${QC_API_BASE}/data_capture_questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
};

export const deleteDataCaptureQuestion = async (id) => {
  const res = await fetch(`${QC_API_BASE}/data_capture_questions/${id}`, { method: 'DELETE' });
  return res.ok;
};
export const getCoachingTemplates = async () => { const res = await fetch(`${API_BASE}/coaching_templates`); return res.json(); };

export const searchLeadsByPhone = async (phone) => {
  const res = await fetch(`${API_BASE}/search/${encodeURIComponent(phone)}`);
  return res.json();
};

export const getDriveTranscript = async (phone, name) => {
  const url = new URL(`${API_BASE}/drive/transcript`);
  if (phone) url.searchParams.append('phone', phone);
  if (name) url.searchParams.append('name', name);
  const response = await fetch(url);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch transcript from Google Drive');
  }
  return response.json();
};

export const getPlaybook = async () => {
  const res = await fetch(`${API_BASE}/playbook`);
  return res.json();
};

export const updatePlaybook = async (content) => {
  const res = await fetch(`${API_BASE}/playbook`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  if (!res.ok) throw new Error('Failed to update playbook');
  return res.json();
};
