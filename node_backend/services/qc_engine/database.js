const supabase = require('../../config/supabase');

async function getActiveRubricVersion(source) {
  let { data, error } = await supabase
    .from('rubric_versions')
    .select('*')
    .eq('source', source)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
    
  if (error) {
    if (error.code === 'PGRST116') return null; // No rows found
    
    // Fallback: If the user hasn't run the migration and 'source' column doesn't exist,
    // we query without the 'source' filter to prevent the server from crashing.
    if (error.message.includes('source does not exist')) {
      console.warn('⚠️ [QC Engine] "source" column missing in rubric_versions. Falling back to default query.');
      const fallback = await supabase
        .from('rubric_versions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (fallback.error && fallback.error.code === 'PGRST116') return null;
      if (fallback.error) throw new Error("Fallback fetch failed: " + fallback.error.message);
      
      // If we got data, we can inject a dummy source so downstream doesn't break
      fallback.data.source = source;
      return fallback.data;
    }

    throw new Error("Failed to fetch active rubric version: " + error.message);
  }
  return data;
}

async function getRubricVersionById(id) {
  const { data, error } = await supabase
    .from('rubric_versions')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error("Failed to fetch rubric version by ID: " + error.message);
  return data;
}

function getQCParametersFromRubric(rubric) {
  if (!rubric || !rubric.parameters || !rubric.parameters.qc_parameters) return [];
  return rubric.parameters.qc_parameters.map(p => ({
    Parameter: p.parameter,
    Category: p.category,
    Description: p.description,
    ParamId: p.param_id,
    CategoryWeightPct: p.category_weight_pct,
    Scale: p.scale,
    Polarity: p.polarity,
    EmbeddedBreachFlag: p.embedded_breach_flag,
    EvidenceRequired: p.evidence_required
  }));
}

function getQualityChecksFromRubric(rubric) {
  if (!rubric || !rubric.parameters || !rubric.parameters.qc_parameters) return [];
  return [...rubric.parameters.qc_parameters].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function getDataCaptureQuestionsFromRubric(rubric) {
  if (!rubric || !rubric.parameters || !rubric.parameters.data_capture_questions) return [];
  return [...rubric.parameters.data_capture_questions].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

async function getPastCalls(prospectId, currentCallId) {
  if (!prospectId) return [];
  let query = supabase
    .from('calls')
    .select('*')
    .eq('prospect_id', prospectId);

  if (currentCallId) {
    query = query.neq('id', currentCallId);
  }

  let { data, error } = await query.order('call_date', { ascending: true, nullsFirst: false });
  if (error && error.message && error.message.includes('call_date')) {
    // Graceful fallback if call_date column has not yet been migrated in Supabase
    let fallbackQuery = supabase
      .from('calls')
      .select('*')
      .eq('prospect_id', prospectId);
    if (currentCallId) fallbackQuery = fallbackQuery.neq('id', currentCallId);
    const fallback = await fallbackQuery.order('id', { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error("Failed to fetch past calls:", error.message);
    return [];
  }
  const calls = data || [];

  // Deterministic in-memory chronological sort (call_date ASC, fallback to id ASC)
  calls.sort((a, b) => {
    if (a.call_date && b.call_date) {
      return new Date(a.call_date).getTime() - new Date(b.call_date).getTime();
    }
    if (a.call_date) return -1;
    if (b.call_date) return 1;
    return String(a.id).localeCompare(String(b.id));
  });

  // Enrich calls with evaluation_runs data (insights_data, summary_data)
  // so the prompt builder has full prior analysis context
  if (calls.length > 0) {
    const callIds = calls.map(c => c.id);
    const { data: evals } = await supabase
      .from('evaluation_runs')
      .select('call_id, results')
      .in('call_id', callIds)
      .order('created_at', { ascending: false });

    if (evals) {
      const evalMap = {};
      evals.forEach(e => {
        if (!evalMap[e.call_id]) evalMap[e.call_id] = e; // latest only
      });
      calls.forEach(c => {
        const ev = evalMap[c.id];
        if (ev && ev.results) {
          c.insights_data = c.insights_data || ev.results.insights_data;
          c.summary_data = c.summary_data || ev.results.summary_data;
        }
      });
    }
  }

  return calls;
}

async function getLeadState(prospectId) {
  if (!prospectId) return null;
  const { data, error } = await supabase
    .from('leads')
    .select('journey_summary, intent_score, bant_insights, data_capture, kalvium_funnel_stage, next_process_step')
    .eq('id', prospectId)
    .single();
  if (error) return null;
  return data;
}

async function getParametersForSource(source, rubric) {
  if (!rubric) {
    rubric = await getActiveRubricVersion(source);
  }
  const params = getQCParametersFromRubric(rubric);
  if (source === 'google_meet') {
    return {
      params,
      role: 'Expert Video Demo Coach',
      context: 'a product demonstration meeting conducted via Google Meet'
    };
  }
  return {
    params,
    role: 'Expert Counselling Coach',
    context: 'a sales counselling phone call for university admissions'
  };
}

async function getQualityChecks(source) {
  const rubric = await getActiveRubricVersion(source);
  if (!rubric) return [];
  const params = getQCParametersFromRubric(rubric);
  return params.map(p => ({
    parameter: p.Parameter,
    category: p.Category,
    description: p.Description,
    param_id: p.ParamId,
    max_score: p.Scale?.max || 2,
    mark_fatal: p.EmbeddedBreachFlag
  }));
}

async function getDataCaptureQuestions(source) {
  // Always prioritize the dedicated table
  const { data: questions } = await supabase
    .from('data_capture_questions')
    .select('*')
    .eq('source', source)
    .order('sort_order', { ascending: true });
    
  if (questions && questions.length > 0) {
    return questions;
  }
  
  // Fallback to rubric embedded questions
  const rubric = await getActiveRubricVersion(source);
  if (!rubric) return [];
  return getDataCaptureQuestionsFromRubric(rubric);
}

module.exports = {
  getActiveRubricVersion,
  getRubricVersionById,
  getQCParametersFromRubric,
  getQualityChecksFromRubric,
  getDataCaptureQuestionsFromRubric,
  getPastCalls,
  getLeadState,
  getParametersForSource,
  getQualityChecks,
  getDataCaptureQuestions,
};
