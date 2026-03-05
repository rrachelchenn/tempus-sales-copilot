import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return new OpenAI({ apiKey });
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

  const openai = getOpenAI();

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

  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
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

  const message = completion.output[0].content[0];
  if (message.type !== "output_text") {
    throw new Error("Unexpected OpenAI response format.");
  }
  const text = message.text.trim();
  let parsed: { provider_name: string; sales_potential_score: number }[] = [];
  try {
    const obj = JSON.parse(text);
    parsed = Array.isArray(obj) ? obj : obj.providers || [];
  } catch {
    // Fallback: naive heuristic
    parsed = rowsWithCrm.map((r) => ({
      provider_name: r.provider_name,
      sales_potential_score:
        Math.min(100, Math.floor(r.estimated_patient_volume / 6)) +
        (r.crm_excerpt?.toLowerCase().includes("dissatisf") ? 20 : 0),
    }));
  }

  const scoreMap = new Map(
    parsed.map((p) => [p.provider_name, p.sales_potential_score])
  );

  const ranked = rowsWithCrm
    .map((r) => ({
      ...r,
      sales_potential_score: scoreMap.get(r.provider_name) ?? 50,
    }))
    .sort(
      (a, b) =>
        (b.sales_potential_score ?? 0) - (a.sales_potential_score ?? 0)
    );

  cachedRanked = ranked;

  return NextResponse.json({
    rankedLeads: ranked,
  });
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST_provider(req: NextRequest) {
  return NextResponse.json(
    { error: "Use /api/analyze/provider route for provider details." },
    { status: 404 }
  );
}

