import { useState } from 'react';
import { triggerMeetSync } from '../api';
import { Video, Loader2, CheckCircle2, AlertCircle, FileText, XCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function MeetSyncView() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setLoading(true);
    setResults(null);
    setError(null);
    
    try {
      const res = await triggerMeetSync();
      if (res && res.success) {
        setResults(res.results);
      } else {
        setError(res?.error || "Unknown error occurred during sync.");
      }
    } catch (err) {
      setError(err.message || "Failed to trigger sync.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6 max-w-4xl mx-auto w-full pt-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Google Meet Sync</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Scan your connected Google Drive for new Meet transcripts and automatically ingest them into the system.
        </p>
      </div>

      <Card className="shadow-sm border-primary/20">
        <CardHeader className="bg-primary/5 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5 text-primary" />
            Manual Sync
          </CardTitle>
          <CardDescription>
            Trigger a manual scan of the Google Drive folder. New transcripts will be pulled, associated with leads, and queued for evaluation.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 flex flex-col gap-6">
          <div className="flex items-center justify-between p-4 border rounded-lg bg-background">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-medium text-sm">Transcript Ingestion</h3>
                <p className="text-xs text-muted-foreground">Scans the configured root folder and all subfolders.</p>
              </div>
            </div>
            <Button 
              onClick={handleSync} 
              disabled={loading}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              {loading ? "Syncing..." : "Start Sync"}
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-4 text-sm text-destructive border border-destructive/20 bg-destructive/10 rounded-lg">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div className="flex flex-col">
                <span className="font-bold">Sync Failed</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {results && (
            <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
              <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">Sync Results</h3>
              <div className="grid grid-cols-3 gap-4">
                <Card className="shadow-none border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                    <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{results.processed || 0}</span>
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-500 uppercase">Processed</span>
                  </CardContent>
                </Card>
                <Card className="shadow-none border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <Clock className="w-8 h-8 text-amber-500 mb-2" />
                    <span className="text-2xl font-bold text-amber-700 dark:text-amber-400">{results.skipped || 0}</span>
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-500 uppercase">Skipped (Already Sync&apos;d)</span>
                  </CardContent>
                </Card>
                <Card className="shadow-none border-muted bg-muted/30">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <FileText className="w-8 h-8 text-muted-foreground mb-2" />
                    <span className="text-2xl font-bold">{results.found || 0}</span>
                    <span className="text-xs font-medium text-muted-foreground uppercase">Total Found</span>
                  </CardContent>
                </Card>
              </div>

              {results.errors && results.errors.length > 0 && (
                <div className="mt-4 p-4 border border-destructive/20 bg-destructive/5 rounded-lg text-sm text-destructive">
                  <div className="font-semibold flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4" />
                    Encountered {results.errors.length} error(s):
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-xs font-mono">
                    {results.errors.map((e, idx) => (
                      <li key={idx}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
