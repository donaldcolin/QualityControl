import { useState, useEffect } from 'react';
import { getQCLead, evaluateCall, evaluateLeadIntelligence, resendCallToASR } from '../api';
import { ArrowLeft, Play, FileAudio, CheckCircle2, Clock, AlertCircle, BrainCircuit, Phone, Video, ChevronDown, ChevronUp, Lightbulb, TrendingUp, TrendingDown, Minus, MessageSquare, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// Grade color helper
function gradeColor(grade) {
  if (!grade) return 'text-muted-foreground';
  const g = grade.toUpperCase();
  if (g === 'A') return 'text-emerald-500';
  if (g === 'B') return 'text-blue-500';
  if (g === 'C') return 'text-amber-500';
  if (g === 'D') return 'text-orange-500';
  return 'text-destructive';
}

function gradeBackground(grade) {
  if (!grade) return 'bg-muted/50 border-muted-foreground/20';
  const g = grade.toUpperCase();
  if (g === 'A') return 'bg-emerald-500/10 border-emerald-500/20';
  if (g === 'B') return 'bg-blue-500/10 border-blue-500/20';
  if (g === 'C') return 'bg-amber-500/10 border-amber-500/20';
  if (g === 'D') return 'bg-orange-500/10 border-orange-500/20';
  return 'bg-destructive/10 border-destructive/20';
}

function scoreBarColor(score) {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-destructive';
}

// Circular score gauge
function ScoreGauge({ score, grade, size = 100 }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius}
          stroke="currentColor" className="text-muted/30" strokeWidth="6" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={radius}
          stroke="currentColor" strokeWidth="6" fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-all duration-1000", gradeColor(grade))}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn("text-2xl font-bold", gradeColor(grade))}>{score}</span>
        <span className={cn("text-xs font-semibold uppercase", gradeColor(grade))}>{grade}</span>
      </div>
    </div>
  );
}

// Category coaching card
function CategoryCard({ name, data }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("rounded-lg p-4 border transition-all duration-200", gradeBackground(data.grade))}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className={cn("text-lg font-bold", gradeColor(data.grade))}>{data.score}</span>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm truncate text-foreground">{name}</h4>
            <div className="w-full bg-background rounded-full h-1.5 mt-1">
              <div className={cn("h-1.5 rounded-full transition-all duration-700", scoreBarColor(data.score))}
                style={{ width: `${data.score}%` }} />
            </div>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 animate-fade-in-up" style={{ animationDuration: '0.2s' }}>
          {data.what_went_well && (
            <div className="flex gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1">What went well</div>
                <p className="text-sm text-muted-foreground">{data.what_went_well}</p>
              </div>
            </div>
          )}
          {data.what_went_wrong && (
            <div className="flex gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-destructive uppercase tracking-wide mb-1">What went wrong</div>
                <p className="text-sm text-muted-foreground">{data.what_went_wrong}</p>
              </div>
            </div>
          )}
          {data.coach_tip && (
            <div className="flex gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
              <Lightbulb className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">Coach tip</div>
                <p className="text-sm text-muted-foreground">{data.coach_tip}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeadDetails({ leadId, onBack }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [evaluatingCall, setEvaluatingCall] = useState(null);
  const [evaluatingIntel, setEvaluatingIntel] = useState(false);
  const [expandedScripts, setExpandedScripts] = useState(false);

  useEffect(() => {
    loadLeadDetails();
  }, [leadId]);

  const loadLeadDetails = () => {
    setLoading(true);
    getQCLead(leadId).then(data => {
      if (!data.error) setLead(data);
      setLoading(false);
    });
  };

  const handleRunQC = async (callId) => {
    setEvaluatingCall(callId);
    try {
      await evaluateCall(callId);
      await loadLeadDetails();
    } catch (error) {
      console.error("QC failed", error);
    }
    setEvaluatingCall(null);
  };

  const handleRunIntelligence = async () => {
    setEvaluatingIntel(true);
    try {
      await evaluateLeadIntelligence(leadId);
      await loadLeadDetails();
    } catch (error) {
      console.error("Intelligence evaluation failed", error);
    }
    setEvaluatingIntel(false);
  };

  if (loading || !lead) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p>Loading Lead History...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-6 max-w-5xl mx-auto w-full">
      <Button
        variant="ghost"
        onClick={onBack}
        className="w-fit -ml-4 gap-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Leads
      </Button>

      {/* Lead Header */}
      <Card className="border-l-4 border-l-primary shadow-sm overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:justify-between items-start gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">{lead.name}</h2>
              <p className="text-muted-foreground mt-1 flex items-center gap-2">
                <span className="font-mono text-sm">{lead.phone || 'No Phone'}</span>
                <span>•</span>
                <span>{lead.calls?.length || 0} Calls Logged</span>
              </p>
            </div>

            <div className="flex flex-col items-end gap-3 w-full md:w-auto">
               <div className={cn(
                 "px-4 py-3 rounded-lg border flex flex-col items-end text-right min-w-[200px] w-full md:w-auto",
                 lead.overall_prediction === true ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400" :
                 lead.overall_prediction === false ? "bg-destructive/10 border-destructive/20 text-destructive" :
                 "bg-muted/50 border-muted-foreground/20 text-muted-foreground"
               )}>
                 <div className="text-sm font-semibold uppercase tracking-wider opacity-80 mb-1">Overall Intelligence</div>
                 <div className="text-lg font-bold">
                   {lead.overall_prediction === true ? 'Will Pay' : lead.overall_prediction === false ? 'Unlikely to Pay' : 'Pending Evaluation'}
                 </div>
               </div>

               <Button
                 variant="outline"
                 onClick={handleRunIntelligence}
                 disabled={evaluatingIntel}
                 className="gap-2 w-full md:w-auto"
               >
                 {evaluatingIntel ? (
                    <><Loader2 className="w-4 h-4 animate-spin"/> Analyzing Journey...</>
                 ) : (
                    <><BrainCircuit className="w-4 h-4"/> Update Lead Intelligence</>
                 )}
               </Button>
            </div>
          </div>
          {lead.overall_reasoning && (
            <div className="mt-6 p-4 bg-muted/50 rounded-lg text-sm border">
              <strong className="text-foreground">AI Reasoning:</strong> <span className="text-muted-foreground ml-1">{lead.overall_reasoning}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <h3 className="text-xl font-bold mt-4 tracking-tight">Call History & Coaching</h3>

      {/* Call Cards */}
      <div className="space-y-6">
        {lead.calls?.map((call) => {
          const report = call.coaching_report;
          const hasCoaching = report && report.overall_score != null;
          const sourceIcon = call.source === 'google_meet'
            ? <Video className="w-3.5 h-3.5 text-purple-500" />
            : <Phone className="w-3.5 h-3.5 text-blue-500" />;
          const sourceLabel = call.source === 'google_meet' ? 'Video Demo' : 'Phone Call';

          return (
            <Card key={call.id} className="overflow-hidden shadow-sm">
              {/* Call Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between p-5 border-b bg-muted/30 gap-4">
                <div className="flex items-center gap-4">
                  <div className="bg-background p-2.5 rounded-full border shadow-sm">
                    <FileAudio className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-lg flex items-center gap-2">
                      Call {call.call_number}
                      <Badge variant="secondary" className="gap-1.5 font-medium">
                        {sourceIcon} {sourceLabel}
                      </Badge>
                    </h4>
                    <span className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="w-3.5 h-3.5" /> {call.duration_sec}s
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={async () => {
                       await resendCallToASR(call.id);
                       alert("Sent to ASR Queue. Check the Queue tab to process it.");
                    }}
                    className="gap-2 w-full md:w-auto"
                    title="Send this call to the ASR model to re-transcribe"
                  >
                    <RefreshCw className="w-4 h-4" /> Send to ASR
                  </Button>
                  
                  {call.qc_status === 'pending' ? (
                    <Button
                      onClick={() => handleRunQC(call.id)}
                      disabled={evaluatingCall === call.id}
                      className="gap-2 w-full md:w-auto"
                    >
                      {evaluatingCall === call.id ? (
                        <><Loader2 className="w-4 h-4 animate-spin"/> Evaluating...</>
                      ) : (
                        <><Play className="w-4 h-4 fill-current" /> Run Coaching QC</>
                      )}
                    </Button>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-3 py-1.5 text-sm gap-1.5 font-medium h-auto w-full justify-center md:w-auto">
                      <CheckCircle2 className="w-4 h-4" /> Evaluated
                    </Badge>
                  )}
                </div>
              </div>

              {/* Coaching Report */}
              {hasCoaching ? (
                <CardContent className="p-5 space-y-6">
                  {/* Scorecard Header */}
                  <div className="flex flex-col md:flex-row items-start gap-6">
                    <div className="mx-auto md:mx-0 shrink-0">
                      <ScoreGauge score={report.overall_score} grade={report.overall_grade} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground leading-relaxed">{report.summary}</p>

                      {/* Quick Stats */}
                      <div className="flex flex-wrap gap-3 mt-4">
                        {report.top_strengths && (
                          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 gap-1.5 font-medium">
                            <TrendingUp className="w-3 h-3" />
                            {report.top_strengths.length} Strengths
                          </Badge>
                        )}
                        {report.critical_improvements && (
                          <Badge variant="secondary" className="bg-destructive/10 text-destructive hover:bg-destructive/20 gap-1.5 font-medium">
                            <TrendingDown className="w-3 h-3" />
                            {report.critical_improvements.length} To Improve
                          </Badge>
                        )}
                        {call.prospect_id && (
                          <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 gap-1.5 font-medium">
                            <CheckCircle2 className="w-3 h-3" />
                            Synced to LSQ
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Strengths & Improvements */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {report.top_strengths && report.top_strengths.length > 0 && (
                      <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                        <h5 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Top Strengths
                        </h5>
                        <ul className="space-y-2">
                          {report.top_strengths.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex gap-2.5 items-start">
                              <span className="text-emerald-500 mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                              <span className="leading-snug">{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {report.critical_improvements && report.critical_improvements.length > 0 && (
                      <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/10">
                        <h5 className="text-xs font-semibold text-destructive uppercase tracking-wide mb-3 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5" /> Must Improve
                        </h5>
                        <ul className="space-y-2">
                          {report.critical_improvements.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex gap-2.5 items-start">
                              <span className="text-destructive mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-destructive"></span>
                              <span className="leading-snug">{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Category Scores */}
                  {report.category_scores && (
                    <div>
                      <h5 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Category Breakdown</h5>
                      <div className="grid md:grid-cols-2 gap-3">
                        {Object.entries(report.category_scores).map(([cat, data]) => (
                          <CategoryCard key={cat} name={cat} data={data} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggested Script Lines */}
                  {report.suggested_script_lines && report.suggested_script_lines.length > 0 && (
                    <div>
                      <Button
                        variant="ghost"
                        onClick={() => setExpandedScripts(!expandedScripts)}
                        className="gap-2 text-primary hover:text-primary hover:bg-primary/5 -ml-4"
                      >
                        <MessageSquare className="w-4 h-4" />
                        Suggested Responses ({report.suggested_script_lines.length})
                        {expandedScripts ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                      </Button>
                      {expandedScripts && (
                        <div className="mt-3 space-y-3 animate-fade-in-up" style={{ animationDuration: '0.2s' }}>
                          {report.suggested_script_lines.map((sl, i) => (
                            <div key={i} className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
                              <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1.5">When: {sl.situation}</div>
                              <p className="text-sm text-muted-foreground italic leading-relaxed">"{sl.suggested_response}"</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Legacy Parameter Details (collapsible) */}
                  {report.parameter_evaluations && (
                    <details className="group mt-4">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 py-2 w-fit">
                        <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                        Detailed Parameter Results ({Object.keys(report.parameter_evaluations).length} params)
                      </summary>
                      <div className="mt-3 space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar border rounded-lg p-3 bg-muted/20">
                        {Object.entries(report.parameter_evaluations).map(([param, evalData]) => (
                          <div key={param} className="p-2 border-b last:border-0 flex flex-col gap-1.5">
                            <div className="flex items-start justify-between gap-4">
                              <span className="text-xs font-medium leading-tight">{param}</span>
                              <Badge variant={
                                evalData.status === 'Pass' ? 'outline' :
                                evalData.status === 'Fail' ? 'destructive' :
                                'secondary'
                              } className={cn("text-[10px] h-5", evalData.status === 'Pass' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20")}>
                                {evalData.status}
                              </Badge>
                            </div>
                            <div className="text-[11px] text-muted-foreground">{evalData.reason}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </CardContent>
              ) : call.qc_status === 'pending' ? (
                /* Pending state */
                <CardContent className="p-8">
                  <div className="flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl p-8 text-center bg-muted/10">
                    <AlertCircle className="w-12 h-12 mb-4 opacity-40 text-primary" />
                    <p className="text-base font-medium text-foreground">Run Coaching QC to see the full coaching report</p>
                    <p className="text-sm mt-1">Scores, strengths, improvements, and coach tips</p>
                  </div>
                </CardContent>
              ) : (
                /* Legacy flat results (old evaluations without coaching_report) */
                <CardContent className="p-5">
                  {call.qc_results && (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-2 border rounded-lg p-3 bg-muted/20">
                      {Object.entries(call.qc_results).map(([param, evalData]) => (
                        <div key={param} className="p-2 border-b last:border-0 flex flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-sm font-medium leading-tight">{param}</span>
                            <Badge variant={
                              evalData.status === 'Pass' ? 'outline' :
                              evalData.status === 'Fail' ? 'destructive' :
                              'secondary'
                            } className={cn("text-xs", evalData.status === 'Pass' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20")}>
                              {evalData.status}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">{evalData.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
