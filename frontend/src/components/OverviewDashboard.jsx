import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, PhoneCall, Volume2, TrendingUp, TrendingDown, Minus, HelpCircle, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { cn } from '../lib/utils';

function formatDuration(seconds) {
  if (!seconds) return '0m 0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM}m`;
  }
  return `${m}m ${s}s`;
}

const COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe'];

export default function OverviewDashboard({ leads }) {
  const metrics = useMemo(() => {
    const allCalls = leads.flatMap(l => l.calls || []);
    const totalCalls = allCalls.length;
    const totalDurationSec = allCalls.reduce((acc, c) => acc + (c.duration_sec || 0), 0);
    const avgDurationSec = totalCalls > 0 ? totalDurationSec / totalCalls : 0;
    const callsOver2Mins = allCalls.filter(c => (c.duration_sec || 0) > 120).length;

    // Talk to listen ratio
    const ttlCalls = allCalls.filter(c => c.talk_to_listen_ratio);
    let avgTtl = "0:0";
    if (ttlCalls.length > 0) {
      let repSum = 0, custSum = 0;
      ttlCalls.forEach(c => {
        const [rep, cust] = c.talk_to_listen_ratio.split(':').map(Number);
        if (!isNaN(rep) && !isNaN(cust)) {
          repSum += rep;
          custSum += cust;
        }
      });
      avgTtl = `${Math.round(repSum/ttlCalls.length)}:${Math.round(custSum/ttlCalls.length)}`;
    }

    // Call Quality Score Avg
    const scoredCalls = allCalls.filter(c => c.call_quality_score != null);
    const avgCallQuality = scoredCalls.length > 0 
        ? Math.round(scoredCalls.reduce((acc, c) => acc + c.call_quality_score, 0) / scoredCalls.length)
        : 0;

    const totalLeads = leads.length;
    const connectedCallsPerLead = totalLeads > 0 ? (totalCalls / totalLeads).toFixed(1) : 0;

    // Kalvium Pipeline Intent Goals
    let intentPay600 = 0, intentPayPAC = 0, intentAdmission = 0, atRisk = 0;
    
    leads.forEach(l => {
        const stage = l.kalvium_funnel_stage || 'Prospect';
        const score = l.intent_score || 0;
        
        if (score < 50 && score > 0) {
            atRisk++;
        } else if (score >= 75) {
            if (stage === 'PAC Paid') intentAdmission++;
            else if (stage === 'Exam Registered' || stage === 'Interviewing') intentPayPAC++;
            else intentPay600++; // Prospect or null
        }
    });

    // Call Quality Gap Chart Data
    const qualityCategories = {};
    scoredCalls.forEach(c => {
        if (c.quality_data) {
            Object.entries(c.quality_data).forEach(([cat, data]) => {
                if (!qualityCategories[cat]) qualityCategories[cat] = { score: 0, max: 0 };
                qualityCategories[cat].score += data.score;
                qualityCategories[cat].max += data.max_score;
            });
        }
    });
    const qualityChartData = Object.entries(qualityCategories).map(([name, data]) => ({
        name,
        score: Math.round((data.score / (data.max || 1)) * 100)
    })).sort((a,b) => b.score - a.score);

    // Key Lead Concerns Pie Chart Data
    const objectionCounts = {};
    allCalls.forEach(c => {
        if (c.insights_data?.objections) {
            c.insights_data.objections.forEach(obj => {
                const cat = obj.category || 'General';
                objectionCounts[cat] = (objectionCounts[cat] || 0) + 1;
            });
        }
    });
    const totalObjections = Object.values(objectionCounts).reduce((a,b)=>a+b, 0);
    const objectionChartData = Object.entries(objectionCounts).map(([name, count]) => ({
        name,
        value: count,
        percentage: Math.round((count/totalObjections)*100)
    })).sort((a,b) => b.value - a.value);

    return {
      totalCalls, totalDurationSec, avgDurationSec, avgTtl, callsOver2Mins, avgCallQuality, connectedCallsPerLead,
      totalLeads, intentPay600, intentPayPAC, intentAdmission, atRisk,
      qualityChartData, objectionChartData, totalObjections
    };
  }, [leads]);

  if (leads.length === 0) return null;

  return (
    <div className="space-y-8 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col gap-4">
        
        {/* ROW 1: CALL METRICS */}
        <div>
          <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
            Total Calls <span className="text-2xl">{metrics.totalCalls}</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard icon={Clock} value={formatDuration(metrics.totalDurationSec)} label="Total Call Duration" color="text-blue-500" />
            <MetricCard icon={Clock} value={formatDuration(metrics.avgDurationSec)} label="Avg. Call Duration" color="text-blue-500" />
            <MetricCard icon={Volume2} value={metrics.avgTtl} label="Talk-to-listen Ratio" color="text-purple-500" />
            <MetricCard icon={PhoneCall} value={metrics.callsOver2Mins} label="Detailed Calls > 2 mins" color="text-emerald-500" />
            <MetricCard icon={TrendingUp} value={metrics.avgCallQuality} label="Call Quality Score" color="text-indigo-500" />
            <MetricCard icon={PhoneCall} value={metrics.connectedCallsPerLead} label="Connected Calls per Lead" color="text-blue-500" />
          </div>
        </div>

        {/* ROW 2: LEAD METRICS (KALVIUM FUNNEL INTENT) */}
        <div className="mt-4">
          <div className="flex flex-wrap justify-between items-end mb-3 gap-2">
             <h3 className="font-bold text-lg flex items-center gap-2">
               Active Pipeline & Conversion Intent <span className="text-2xl">{metrics.totalLeads} Leads</span>
             </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard icon={TrendingUp} value={metrics.intentPay600} label="High Intent (Pay ₹600)" color="text-emerald-500" sub={<span className="text-emerald-600 bg-emerald-500/10 px-1 rounded text-[10px]">{Math.round((metrics.intentPay600/metrics.totalLeads)*100||0)}%</span>} />
            <MetricCard icon={TrendingUp} value={metrics.intentPayPAC} label="High Intent (Pay PAC)" color="text-blue-500" sub={<span className="text-blue-600 bg-blue-500/10 px-1 rounded text-[10px]">{Math.round((metrics.intentPayPAC/metrics.totalLeads)*100||0)}%</span>} />
            <MetricCard icon={TrendingUp} value={metrics.intentAdmission} label="High Intent (Admission)" color="text-indigo-500" sub={<span className="text-indigo-600 bg-indigo-500/10 px-1 rounded text-[10px]">{Math.round((metrics.intentAdmission/metrics.totalLeads)*100||0)}%</span>} />
            <MetricCard icon={TrendingDown} value={metrics.atRisk} label="At Risk / Low Intent" color="text-destructive" sub={<span className="text-destructive bg-destructive/10 px-1 rounded text-[10px]">{Math.round((metrics.atRisk/metrics.totalLeads)*100||0)}%</span>} />
          </div>
        </div>
      </div>

      {/* ROW 3: CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Bar Chart: Quality Gap */}
        <Card className="shadow-md border-border/50 rounded-xl overflow-hidden">
          <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
            <CardTitle className="text-sm flex items-center gap-3">
               <Badge variant="secondary" className="bg-background shadow-sm">Call Quality Score</Badge>
               <span className="text-muted-foreground font-normal">Call Quality Gap</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 pb-2">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.qualityChartData} layout="vertical" margin={{ top: 0, right: 30, left: 50, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" stroke="hsl(var(--foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    cursor={{fill: 'hsl(var(--muted))', opacity: 0.2}} 
                    contentStyle={{borderRadius: '8px', border: '1px solid hsl(var(--border))', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}}
                  />
                  <Bar dataKey="score" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={16}>
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pie Chart: Key Lead Concerns */}
        <Card className="shadow-md border-border/50 rounded-xl overflow-hidden">
          <CardHeader className="bg-muted/20 border-b border-border/50 pb-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold">Key Lead Concerns</CardTitle>
            <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
               Total Concerns: {metrics.totalObjections} <span className="mx-2">|</span> Unique Contacts: {metrics.totalLeads}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="h-[240px] w-[240px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={metrics.objectionChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius={110}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {metrics.objectionChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{borderRadius: '8px', border: '1px solid hsl(var(--border))'}} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-4">
                 {metrics.objectionChartData.slice(0, 3).map((item, idx) => (
                    <div key={idx}>
                       <div className="flex items-center gap-2 mb-1">
                          <div className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS[idx % COLORS.length]}}></div>
                          <span className="font-bold text-sm">{item.percentage}% {item.name}</span>
                       </div>
                       <p className="text-xs text-muted-foreground pl-4">Concerns related to the perceived difficulty or requirements.</p>
                    </div>
                 ))}
                 {metrics.objectionChartData.length === 0 && (
                   <div className="text-muted-foreground text-sm italic">No concerns detected yet.</div>
                 )}
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, value, label, color, sub }) {
  return (
    <Card className="shadow-sm border-border/50 rounded-xl bg-background/50 backdrop-blur-sm overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Icon className={cn("w-4 h-4", color)} />
          {sub && sub}
        </div>
        <div className="text-xl font-bold text-foreground mb-1">
          {value}
        </div>
        <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider leading-tight">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}
