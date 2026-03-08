import { NextRequest, NextResponse } from "next/server";
import { getLLM, hasLLMKey } from "@/lib/llm";

type ProviderRow = {
  provider_name: string;
  clinic_name: string;
  oncology_subspecialty: string;
  estimated_patient_volume: number;
  sales_potential_score?: number;
  crm_excerpt?: string;
};

let cachedKb = "";
let cachedCrm = "";
let cachedRanked: ProviderRow[] | null = null;

function heuristicScore(volume: number, crmExcerpt: string): number {
  const dissatisf = crmExcerpt.toLowerCase().includes("dissatisf");
  return Math.min(
    100,
    Math.max(1, 30 + Math.floor(volume / 6) + (dissatisf ? 25 : 0))
  );
}

function parseScoresFromLLM(
  text: string,
  rowsWithCrm: { provider_name: string; estimated_patient_volume: number; crm_excerpt?: string }[]
): { provider_name: string; sales_potential_score: number }[] {
  if (!text) return rowsWithCrm.map((r) => ({
    provider_name: r.provider_name,
    sales_potential_score: heuristicScore(r.estimated_patient_volume, r.crm_excerpt ?? ""),
  }));

  try {
    const obj = JSON.parse(text) as unknown;
    let list: { provider_name: string; sales_potential_score: number }[] = [];

    if (Array.isArray(obj)) {
      list = obj.map((item: Record<string, unknown>) => ({
        provider_name: String(item.provider_name ?? item.providerName ?? item.name ?? ""),
        sales_potential_score: Number(item.sales_potential_score ?? item.score ?? item.salesPotentialScore ?? 50),
      })).filter((p) => p.provider_name);
    } else if (obj && typeof obj === "object") {
      const arr = (obj as Record<string, unknown>).providers ?? (obj as Record<string, unknown>).ranked ?? (obj as Record<string, unknown>).scores;
      if (Array.isArray(arr)) {
        list = arr.map((item: Record<string, unknown>) => ({
          provider_name: String(item.provider_name ?? item.providerName ?? item.name ?? ""),
          sales_potential_score: Number(item.sales_potential_score ?? item.score ?? item.salesPotentialScore ?? 50),
        })).filter((p) => p.provider_name);
      } else if (arr && typeof arr === "object" && !Array.isArray(arr)) {
        list = Object.entries(arr as Record<string, number>).map(([name, score]) => ({
          provider_name: name.trim(),
          sales_potential_score: Number(score) || 50,
        }));
      }
    }

    if (list.length > 0) return list;
  } catch {
    /* fall through to heuristic */
  }

  return rowsWithCrm.map((r) => ({
    provider_name: r.provider_name,
    sales_potential_score: heuristicScore(r.estimated_patient_volume, r.crm_excerpt ?? ""),
  }));
}

function findCrmExcerpt(providerName: string, crmText: string): string {
  const nameShort = providerName.replace(/^Dr\\.\\s*/i, "").trim();
  const segments = crmText.split(/\n(?=Dr\\. )/);
  for (const seg of segments) {
    const header = seg.split("(")[0];
    if (header.includes(nameShort) || header.includes(providerName)) {
      return seg.trim();
    }
  }
  const line = crmText
    .split("\n")
    .find((l) => l.includes(providerName) || l.includes(nameShort));
  return line?.trim() || "No CRM notes found for this provider.";
}

export async function POST(req: NextRequest) {
  if (!hasLLMKey()) {
    return NextResponse.json(
      {
        error:
          "No API key set. Add GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY in Vercel → Settings → Environment Variables, then Redeploy.",
      },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const { marketIntel, tempusKb, crmNotes } = body as {
      marketIntel: ProviderRow[];
      tempusKb: string;
      crmNotes: string;
    };

    if (!marketIntel || !Array.isArray(marketIntel)) {
      return NextResponse.json(
        { error: "marketIntel must be an array." },
        { status: 400 }
      );
    }

    cachedKb = tempusKb || "";
    cachedCrm = crmNotes || "";

    const { client, model } = getLLM();

    const rowsWithCrm = marketIntel.map((row) => {
      const crm_excerpt = findCrmExcerpt(row.provider_name, crmNotes || "");
      return { ...row, crm_excerpt };
    });

    const prompt = `You are a sales analyst for Tempus.
Given the following providers with fields: provider_name, clinic_name, oncology_subspecialty, estimated_patient_volume, and crm_excerpt,
assign each provider a Sales Potential Score from 1 to 100.

Prioritize: (1) higher estimated_patient_volume and (2) explicit dissatisfaction or concern in crm_excerpt about tissue-only testing, long turnaround time, or false positives.

Return ONLY valid JSON: an array of objects, each with:
  { "provider_name": string, "sales_potential_score": number }

Providers:
${JSON.stringify(rowsWithCrm, null, 2)}
`;

    let completion;
    try {
      completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You convert provider lead data into ranked JSON. Respond with JSON only, no commentary.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
      });
    } catch (apiErr: unknown) {
      const msg =
        apiErr instanceof Error ? apiErr.message : String(apiErr);
      return NextResponse.json(
        {
          error:
            msg.includes("API key") || msg.includes("api_key") || msg.includes("quota")
              ? "Invalid API key or quota exceeded. Try free Groq: add GROQ_API_KEY from console.groq.com in Vercel env vars."
              : `API error: ${msg}`,
        },
        { status: 502 }
      );
    }

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parseScoresFromLLM(text, rowsWithCrm);

    const scoreMap = new Map(
      parsed.map((p) => [p.provider_name, p.sales_potential_score])
    );

    const ranked = rowsWithCrm
      .map((r) => ({
        ...r,
        sales_potential_score:
          scoreMap.get(r.provider_name) ??
          heuristicScore(r.estimated_patient_volume, r.crm_excerpt ?? ""),
      }))
      .sort(
        (a, b) =>
          (b.sales_potential_score ?? 0) - (a.sales_potential_score ?? 0)
      );

    cachedRanked = ranked;

    return NextResponse.json({
      rankedLeads: ranked,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to analyze leads.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

