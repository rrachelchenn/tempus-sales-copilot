"use client";

import { useState } from "react";
import Papa from "papaparse";

type ProviderRow = {
  provider_name: string;
  clinic_name: string;
  oncology_subspecialty: string;
  estimated_patient_volume: number;
  sales_potential_score?: number;
  crm_excerpt?: string;
};

type AnalysisResponse = {
  rankedLeads: ProviderRow[];
};

export default function HomePage() {
  const [marketFile, setMarketFile] = useState<File | null>(null);
  const [kbFile, setKbFile] = useState<File | null>(null);
  const [crmFile, setCrmFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rankedLeads, setRankedLeads] = useState<ProviderRow[]>([]);
  const [tempusKbText, setTempusKbText] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [objection, setObjection] = useState<string | null>(null);
  const [pitch, setPitch] = useState<string | null>(null);
  const [keyMetricsFromKb, setKeyMetricsFromKb] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copied, setCopied] = useState<"objection" | "pitch" | null>(null);

  async function handleAnalyze() {
    setError(null);
    setObjection(null);
    setPitch(null);
    setSelectedIndex(null);
    if (!marketFile || !kbFile || !crmFile) {
      setError("Please upload all three files before running the analysis.");
      return;
    }

    setLoading(true);
    try {
      const [marketText, kbText, crmText] = await Promise.all([
        marketFile.text(),
        kbFile.text(),
        crmFile.text(),
      ]);

      const parsed = Papa.parse(marketText, {
        header: true,
        skipEmptyLines: true,
      });
      const rows: ProviderRow[] = (parsed.data as any[]).map((r) => ({
        provider_name: String(r.provider_name || "").trim(),
        clinic_name: String(r.clinic_name || "").trim(),
        oncology_subspecialty: String(r.oncology_subspecialty || "").trim(),
        estimated_patient_volume: Number(r.estimated_patient_volume || 0),
      }));

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketIntel: rows,
          tempusKb: kbText,
          crmNotes: crmText,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errMsg = "Failed to analyze leads.";
        try {
          const j = JSON.parse(text);
          if (j && typeof j.error === "string") errMsg = j.error;
        } catch {
          if (text && text.trim().startsWith("<")) {
            errMsg =
              "Server error. Add OPENAI_API_KEY in Vercel (Settings → Environment Variables), then redeploy.";
          } else if (text) {
            errMsg = text.length > 280 ? text.slice(0, 280) + "…" : text;
          }
        }
        throw new Error(errMsg);
      }
      const data: AnalysisResponse = await res.json();
      setRankedLeads(data.rankedLeads || []);
      setTempusKbText(kbText);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string, which: "objection" | "pitch") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function loadDetails(index: number) {
    setSelectedIndex(index);
    setObjection(null);
    setPitch(null);
    setKeyMetricsFromKb([]);
    const lead = rankedLeads[index];
    if (!lead) return;

    setDetailLoading(true);
    try {
      const res = await fetch("/api/analyze/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: lead, tempusKb: tempusKbText }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to generate details.");
      }
      const data = (await res.json()) as {
        objectionHandler: string;
        pitch: string;
        keyMetricsFromKb?: string[];
      };
      setObjection(data.objectionHandler);
      setPitch(data.pitch);
      setKeyMetricsFromKb(data.keyMetricsFromKb ?? []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong fetching details.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-8 md:flex-row">
      <aside className="w-full rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:w-80">
        <h1 className="text-xl font-semibold">Tempus Sales Copilot</h1>
        <p className="mt-1 text-sm text-slate-300">
          For sales reps: prioritize leads, handle objections with KB-backed
          rebuttals, and use the 30s pitch—all from your uploaded data.
        </p>

        <div className="mt-4 space-y-3 text-sm">
          <div>
            <label className="font-medium">Market intel CSV</label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setMarketFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-xs text-slate-200"
            />
          </div>
          <div>
            <label className="font-medium">Tempus KB (Markdown)</label>
            <input
              type="file"
              accept=".md,.markdown,.txt"
              onChange={(e) => setKbFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-xs text-slate-200"
            />
          </div>
          <div>
            <label className="font-medium">CRM notes (Text)</label>
            <input
              type="file"
              accept=".txt,.md"
              onChange={(e) => setCrmFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-xs text-slate-200"
            />
          </div>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="mt-4 w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Analyzing leads..." : "Run analysis"}
        </button>

        {error && (
          <p className="mt-3 text-xs text-red-400">
            <span className="font-semibold">Error:</span> {error}
          </p>
        )}

        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Ranked Lead List
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Sales potential score (1–100): based on estimated patient volume and
            CRM signals (e.g. dissatisfaction with TAT, tissue, or current
            vendor). Higher = higher-priority lead.
          </p>
          <div className="mt-2 max-h-[380px] space-y-1 overflow-auto pr-1 text-sm">
            {rankedLeads.length === 0 && (
              <p className="text-xs text-slate-500">
                Run the analysis to see ranked providers.
              </p>
            )}
            {rankedLeads.map((lead, idx) => (
              <button
                key={lead.provider_name + idx}
                onClick={() => loadDetails(idx)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-800 ${
                  selectedIndex === idx ? "bg-slate-800" : ""
                }`}
              >
                <span className="truncate">
                  #{idx + 1} {lead.provider_name}
                </span>
                <span className="ml-2 shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-100">
                  {lead.sales_potential_score ?? "–"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex-1 space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        {selectedIndex == null ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Select a lead from the left to see their profile, objection handler,
            and 30s pitch.
          </div>
        ) : (
          <>
            <header className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-semibold">
                {rankedLeads[selectedIndex].provider_name}
              </h2>
              <p className="text-xs text-slate-400">
                {rankedLeads[selectedIndex].clinic_name} ·{" "}
                {rankedLeads[selectedIndex].oncology_subspecialty}
              </p>
            </header>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Lead Profile
                </h3>
                <p>
                  <span className="font-semibold">Specialty:</span>{" "}
                  {rankedLeads[selectedIndex].oncology_subspecialty}
                </p>
                <p>
                  <span className="font-semibold">Est. patient volume:</span>{" "}
                  {rankedLeads[selectedIndex].estimated_patient_volume}
                </p>
                <p>
                  <span className="font-semibold">Sales potential score:</span>{" "}
                  {rankedLeads[selectedIndex].sales_potential_score}
                  <span className="ml-1 text-slate-500">/ 100</span>
                </p>
                <p className="text-xs text-slate-500">
                  Volume + CRM signals (dissatisfaction, TAT/tissue concerns).
                </p>
              </div>

              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  CRM Snapshot
                </h3>
                <p className="whitespace-pre-wrap text-xs text-slate-200">
                  {rankedLeads[selectedIndex].crm_excerpt ||
                    "No CRM notes found for this provider."}
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Objection Handler
                </h3>
                {objection && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(objection, "objection")}
                    className="shrink-0 rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    {copied === "objection" ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
              {detailLoading && !objection ? (
                <p className="text-xs text-slate-400">
                  Drafting rebuttal based on CRM and Tempus KB...
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-slate-100">
                  {objection}
                </p>
              )}
              {keyMetricsFromKb.length > 0 && (
                <div className="mt-3 border-t border-slate-700 pt-3">
                  <h4 className="mb-2 text-xs font-semibold text-slate-400">
                    Key metrics to reference (from Tempus KB)
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {keyMetricsFromKb.map((m, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-slate-500">•</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Use these when the physician asks for specifics or
                    follow-up.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  30-Second Pitch
                </h3>
                {pitch && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(pitch, "pitch")}
                    className="shrink-0 rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    {copied === "pitch" ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
              {detailLoading && !pitch ? (
                <p className="text-xs text-slate-400">
                  Writing a personalized, data-driven pitch...
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-slate-100">
                  {pitch}
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

