import { Badge } from '@/components/ui/badge';
import { UserCheck, Database, Info, Star, Clock, MessageSquare, Target, XCircle } from 'lucide-react';

export default function LeadSidebar({ lead, embedded, sqlStatus, totalDuration, avgTtl, intentScore, avgQuality }) {
  if (!lead) return null;
  
  return (
    <>
      {/* HEADER SECTION - ZIPTEAMS CLONE */}
      {!embedded ? (
        <div className="border-b px-8 py-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-400 text-white rounded-full flex items-center justify-center text-xl font-bold shadow-sm">
              {lead.name?.charAt(0).toUpperCase() || '?'}
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight mb-1 flex items-center gap-2">
                {lead.name}
                {sqlStatus === 'SQL' && (
                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 ml-2 border-emerald-200">
                    <Star className="w-3 h-3 mr-1 fill-emerald-500" /> Sales Qualified Lead
                  </Badge>
                )}
                {sqlStatus === 'No SQL' && (
                  <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-200 ml-2 border-rose-200">
                    No SQL
                  </Badge>
                )}
                {sqlStatus === 'Not Mentioned' && (
                  <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-200 ml-2 border-slate-200">
                    Not Mentioned
                  </Badge>
                )}
              </h1>
              <div className="flex gap-4 text-xs text-muted-foreground items-center">
                <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> {lead.phone || lead.email || '—'}</span>
                <span className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Owner Name: <span className="font-semibold text-foreground">{lead.owner || 'Unassigned'}</span></span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {[
              { value: `${Math.ceil(totalDuration / 60)} mins`, label: 'Total Conversation Duration' },
              { value: avgTtl, label: 'Talk-to-Listen Ratio', icon: <Info className="w-3 h-3 text-muted-foreground inline-block ml-1" /> },
              { value: `${intentScore}/100`, label: 'Intent Score' },
              { value: `${avgQuality}%`, label: 'Avg. Call Quality Score' },
            ].map((stat, i) => (
              <div key={i} className="bg-slate-100 rounded-lg p-3 px-4 min-w-[140px]">
                <div className="text-lg font-bold">{stat.value}</div>
                <div className="text-xs text-slate-500 mt-1 whitespace-nowrap">{stat.label}{stat.icon}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-slate-50/80 border-b px-8 py-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">

            {/* Lead Status Card */}
            <div className={`flex items-center gap-3 px-3 py-2.5 border rounded-xl shadow-sm ${sqlStatus === 'SQL' ? 'bg-emerald-50/50 border-emerald-100' : sqlStatus === 'No SQL' ? 'bg-rose-50/50 border-rose-100' : 'bg-white border-slate-200'}`}>
              <div className={`p-1.5 rounded-lg ${sqlStatus === 'SQL' ? 'bg-emerald-100 text-emerald-600' : sqlStatus === 'No SQL' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
                {sqlStatus === 'SQL' ? <Star className="w-4 h-4 fill-current" /> : sqlStatus === 'No SQL' ? <XCircle className="w-4 h-4" /> : <Info className="w-4 h-4" />}
              </div>
              <div className="flex flex-col">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${sqlStatus === 'SQL' ? 'text-emerald-700' : sqlStatus === 'No SQL' ? 'text-rose-700' : 'text-slate-500'}`}>Lead Status</span>
                <span className={`text-sm font-bold leading-tight ${sqlStatus === 'SQL' ? 'text-emerald-900' : sqlStatus === 'No SQL' ? 'text-rose-900' : 'text-slate-900'}`}>
                  {sqlStatus === 'SQL' ? 'Sales Qualified' : sqlStatus === 'No SQL' ? 'No SQL' : 'Not Mentioned'}
                </span>
              </div>
            </div>

            {/* Total Duration Card */}
            <div className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                <Clock className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Duration</span>
                <span className="text-sm font-bold text-slate-900 leading-tight">{Math.ceil(totalDuration / 60)} mins</span>
              </div>
            </div>

            {/* Talk-to-Listen Ratio Card */}
            <div className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rep : Cust</span>
                <span className="text-sm font-bold text-slate-900 leading-tight">{avgTtl}</span>
              </div>
            </div>

            {/* Intent Score Card */}
            <div className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                <Target className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Intent</span>
                <span className="text-sm font-bold text-slate-900 leading-tight">{intentScore}/100</span>
              </div>
            </div>

            {/* Avg. Call Quality Score Card */}
            <div className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
              <div className="p-1.5 bg-purple-50 text-purple-600 rounded-lg">
                <Star className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Quality</span>
                <span className="text-sm font-bold text-slate-900 leading-tight">{avgQuality}%</span>
              </div>
            </div>

          </div>
        </div>
      )}

    </>
  );
}