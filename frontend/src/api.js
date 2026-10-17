const API_BASE = '/api';
const QC_API_BASE = '/api';

const DEFAULT_AUTH_SECRET = 'internal_qc_worker_secret_2026';

/**
 * Retrieves the active authorization token.
 * Checks localStorage for user session token first, falling back to internal worker secret.
 */
export function getAuthToken() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('qc_auth_token') || localStorage.getItem('supabase_auth_token');
    if (stored) return stored;
  }
  return DEFAULT_AUTH_SECRET;
}

/**
 * Sets a custom auth token in localStorage.
 */
export function setAuthToken(token) {
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('qc_auth_token', token);
    } else {
      localStorage.removeItem('qc_auth_token');
    }
  }
}

/**
 * Centralized, authenticated fetch client with robust error verification,
 * auth expiration broadcasting, and transient network retry logic.
 */
async function apiRequest(endpoint, options = {}, isRetry = false) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const headers = {
    'Authorization': `Bearer ${getAuthToken()}`,
    ...(options.headers || {})
  };

  // Do not set Content-Type if payload is FormData (browser needs to set multipart boundary)
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers
    });
  } catch (netErr) {
    // Retry once for idempotent GET requests on transient network drops
    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    if (isGet && !isRetry) {
      await new Promise(r => setTimeout(r, 1000));
      return apiRequest(endpoint, options, true);
    }
    throw netErr;
  }

  if (!res.ok) {
    // Notify application of auth expiration for seamless session renewal or login redirect
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:expired', { detail: { endpoint, status: 401 } }));
    }

    let errorMessage = `Request failed (HTTP ${res.status}: ${res.statusText})`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.error) {
        errorMessage = errJson.error;
      }
    } catch (_) {
      try {
        const text = await res.text();
        if (text) errorMessage = text;
      } catch (__) {}
    }
    throw new Error(errorMessage);
  }

  // Handle empty bodies (204 No Content)
  if (res.status === 204) {
    return true;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

/**
 * Diagnostic healthcheck endpoint for 24/7 observability.
 */
export const getSystemHealth = async () => {
  return apiRequest('/health');
};

// ── Run & Upload Endpoints ──────────────────────────────────────────────────

export const startRun = async (folder_path, language) => {
  return apiRequest('/run', {
    method: 'POST',
    body: JSON.stringify({ folder_path, language })
  });
};

export const startUploadRun = async (files, language) => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  formData.append('language', language);

  return apiRequest('/upload_run', {
    method: 'POST',
    body: formData
  });
};

export const getRunStatus = async (batchId) => {
  return apiRequest(`/runs/${batchId}/status`);
};

// ── Calls & Audio ──────────────────────────────────────────────────────────

export const getCalls = async () => {
  return apiRequest('/calls');
};

export const getCall = async (callId) => {
  return apiRequest(`/calls/${callId}`);
};

export const rateCall = async (callId, rating, notes) => {
  return apiRequest(`/calls/${callId}/rating`, {
    method: 'POST',
    body: JSON.stringify({ rating, notes })
  });
};

export const resendCallToASR = async (callId) => {
  return apiRequest(`/calls/${callId}/send_to_asr`, { method: 'POST' });
};

// ── Associates ─────────────────────────────────────────────────────────────

export const getAssociates = async () => {
  return apiRequest('/associates');
};

export const syncAssociates = async () => {
  return apiRequest('/associates/sync');
};

export const addAssociate = async (emp_number, emp_name, emp_tags, language) => {
  return apiRequest('/associates', {
    method: 'POST',
    body: JSON.stringify({ emp_number, emp_name, emp_tags, language })
  });
};

export const removeAssociate = async (emp_number) => {
  return apiRequest(`/associates/${emp_number}`, {
    method: 'DELETE'
  });
};

export const getAssociateCalls = async (emp_number) => {
  return apiRequest(`/associates/${emp_number}/calls`);
};

export const getLeadsForAssociate = async (userId) => {
  return apiRequest(`/associates/${userId}/leads`);
};

// ── Leads & Activities ─────────────────────────────────────────────────────

export const getActivitiesForLead = async (prospectId) => {
  return apiRequest(`/leads/${prospectId}/activities`);
};

export const getQCLeads = async () => {
  return apiRequest('/leads');
};

export const getQCLead = async (id) => {
  return apiRequest(`/leads/${id}`);
};

export const getDashboardKPIs = async () => {
  return apiRequest('/dashboard_kpis');
};

export const searchLeadsByPhone = async (phone) => {
  return apiRequest(`/search/${encodeURIComponent(phone)}`);
};

// ── Queue Management ───────────────────────────────────────────────────────

export const getQueue = async () => {
  return apiRequest('/queue');
};

export const sendToQC = async (queueId) => {
  return apiRequest(`/queue/${queueId}/send_to_qc`, { method: 'POST' });
};

export const pushActivityToQC = async (activityData) => {
  return apiRequest('/activities/push_to_qc', {
    method: 'POST',
    body: JSON.stringify(activityData)
  });
};

export const pushDemoToQC = async (data) => {
  return apiRequest('/activities/push_demo_to_qc', {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const scanLead = async (data) => {
  return apiRequest('/orchestrate/scan_lead', {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const getQueueItemStatus = async (queueId) => {
  return apiRequest(`/queue/${queueId}`);
};

export async function deleteQueueItem(id) {
  return apiRequest(`/queue/${id}`, { method: 'DELETE' });
}

export async function bumpQueueItem(id) {
  return apiRequest(`/queue/${id}/bump`, { method: 'POST' });
}

export async function retryQueueItem(id) {
  return apiRequest(`/queue/${id}/retry`, { method: 'POST' });
}

export const getGovernorStatus = async () => {
  return apiRequest('/queue/governor/status');
};

export const playQueueGate = async () => {
  return apiRequest('/queue/gate/play', { method: 'POST' });
};

export const pauseQueueGate = async () => {
  return apiRequest('/queue/gate/pause', { method: 'POST' });
};

export const stepQueueGate = async () => {
  return apiRequest('/queue/gate/step', { method: 'POST' });
};

export const clearQueueGate = async (types = ['completed', 'rejected']) => {
  return apiRequest('/queue/gate/clear', {
    method: 'POST',
    body: JSON.stringify({ types })
  });
};

export const toggleGovernorKillswitch = async (enabled) => {
  return apiRequest('/queue/governor/killswitch', {
    method: 'POST',
    body: JSON.stringify({ enabled })
  });
};

// ── Auto-Scanner Control ─────────────────────────────────────────────────

export const getScannerStatus = async () => {
  return apiRequest('/queue/scanner/status');
};

export const pauseScanner = async () => {
  return apiRequest('/queue/scanner/pause', { method: 'POST' });
};

export const resumeScanner = async () => {
  return apiRequest('/queue/scanner/resume', { method: 'POST' });
};

export const triggerScan = async () => {
  return apiRequest('/queue/scanner/trigger', { method: 'POST' });
};

// ── QC Engine & Evaluation ─────────────────────────────────────────────────

export const getQcMode = async () => {
  return apiRequest('/qc/mode');
};

export const setQcMode = async (mode) => {
  return apiRequest('/qc/mode', {
    method: 'POST',
    body: JSON.stringify({ mode })
  });
};

export const getBatchQCStatus = async () => {
  return apiRequest('/qc/batch/status');
};

export const startBatchQC = async (concurrency = 4, targetCallIds = null) => {
  return apiRequest('/qc/batch/start', {
    method: 'POST',
    body: JSON.stringify({ concurrency, targetCallIds })
  });
};

export const stopBatchQC = async () => {
  return apiRequest('/qc/batch/stop', {
    method: 'POST'
  });
};

export const purgeQCCache = async () => {
  return apiRequest('/qc/batch/purge_cache', {
    method: 'POST'
  });
};

export const evaluateCall = async (call_id, transcript = null, prospect_id = null, immediate = false) => {
  return apiRequest('/qc/evaluate_call', {
    method: 'POST',
    body: JSON.stringify({ call_id, transcript, prospect_id, immediate })
  });
};

export const evaluateLeadIntelligence = async (lead_id) => {
  return apiRequest('/intelligence/evaluate_lead', {
    method: 'POST',
    body: JSON.stringify({ lead_id })
  });
};

export const evaluateJourney = async (prospectId) => {
  return apiRequest('/qc/evaluate_journey', {
    method: 'POST',
    body: JSON.stringify({ prospect_id: prospectId })
  });
};

export const seedQCDemo = async () => {
  return apiRequest('/demo/seed', { method: 'POST' });
};

// ── Orchestrator & Integrations ────────────────────────────────────────────

export const triggerMeetSync = async () => {
  return apiRequest('/meet_sync/trigger', { method: 'POST' });
};

export const scanAll = async () => {
  return apiRequest('/orchestrate/scan_all', { method: 'POST' });
};

export const getScanStatus = async () => {
  return apiRequest('/orchestrate/scan_status');
};

export const pushCoachingToLSQ = async (prospect_id, coaching_report, source) => {
  return apiRequest('/coaching/push_to_lsq', {
    method: 'POST',
    body: JSON.stringify({ prospect_id, coaching_report, source })
  });
};

// ── Quality Parameters CRUD ────────────────────────────────────────────────

export const getQCParameters = async (source = 'phone_call') => {
  return apiRequest(`/quality_checks?source=${encodeURIComponent(source)}`);
};

export const createQCParameter = async (data) => {
  return apiRequest('/quality_checks', {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const updateQCParameter = async (id, data) => {
  return apiRequest(`/quality_checks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const deleteQCParameter = async (id) => {
  await apiRequest(`/quality_checks/${id}`, { method: 'DELETE' });
  return true;
};

// ── Data Capture Questions CRUD ────────────────────────────────────────────

export const getDataCaptureQuestions = async (source = 'phone_call') => {
  return apiRequest(`/data_capture_questions?source=${encodeURIComponent(source)}`);
};

export const createDataCaptureQuestion = async (data) => {
  return apiRequest('/data_capture_questions', {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const updateDataCaptureQuestion = async (id, data) => {
  return apiRequest(`/data_capture_questions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const deleteDataCaptureQuestion = async (id) => {
  await apiRequest(`/data_capture_questions/${id}`, { method: 'DELETE' });
  return true;
};

// ── Google Drive & Playbook ────────────────────────────────────────────────

export const getDriveTranscript = async (phone, name) => {
  const params = new URLSearchParams();
  if (phone) params.append('phone', phone);
  if (name) params.append('name', name);
  return apiRequest(`/drive/transcript?${params.toString()}`);
};

export const getPlaybook = async () => {
  return apiRequest('/playbook');
};

export const updatePlaybook = async (content) => {
  return apiRequest('/playbook', {
    method: 'PUT',
    body: JSON.stringify({ content })
  });
};
