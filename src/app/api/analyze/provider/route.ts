import { NextRequest, NextResponse } from "next/server";
import { getLLM } from "@/lib/llm";

type ProviderRow = {
  provider_name: string;
  clinic_name: string;
  oncology_subspecialty: string;
  estimated_patient_volume: number;
  sales_potential_score?: number;
  crm_excerpt?: string;
};

/** Ask LLM to pick key metrics from the KB that are most relevant to this doctor. */
async function getPersonalizedKeyMetrics(
  client: Awaited<ReturnType<typeof getLLM>>["client"],
  model: string,
  provider: ProviderRow,
  objectionHandler: string,
  pitch: string,
  tempusKb: string
): Promise<string[]> {
  if (!tempusKb?.trim()) return [];

  const system =
    "You are a Tempus sales expert. Given a physician's profile, their CRM concern, the objection-handling response, and the pitch script, select 4–8 specific metrics or facts from the Tempus Knowledge Base that are most relevant for this rep to reference if the physician asks follow-up questions. Pick stats that directly support the objection response and pitch (e.g. TAT, gene counts, percentages). Return ONLY valid JSON in this exact shape: {\"metrics\": [\"string1\", \"string2\", ...]}. Each string is one concise metric (e.g. \"xF+ TAT: 7–9 days\", \"Tumor+normal: 28% fewer false positives\"). No other keys or commentary.";

  const user = `Physician: ${provider.provider_name}
Specialty: ${provider.oncology_subspecialty}
CRM concern/notes: ${provider.crm_excerpt ?? "None"}

Objection handler (what the rep will say):
${objectionHandler}

30s pitch (what the rep will say):
${pitch}

Tempus Knowledge Base (choose metrics only from here):
${tempusKb}

Return JSON: {"metrics": ["...", "..."]} with 4–8 metric strings most relevant to this doctor.`;

  try {
    const res = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    const text = res.choices[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(text) as unknown;
    const obj = parsed as Record<string, unknown>;
    const list = Array.isArray(parsed)
      ? parsed
      : (obj.metrics ?? obj.keyMetrics ?? []) as unknown[];
    if (!Array.isArray(list)) return [];
    return list
      .filter((x): x is string => typeof x === "string")
      .slice(0, 10);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider: ProviderRow;
    tempusKb?: string;
  };
  const { provider, tempusKb = "" } = body;
  if (!provider) {
    return NextResponse.json(
      { error: "Missing provider in request body." },
      { status: 400 }
    );
  }

  const objectionSystem =
    "You are a Tempus sales expert. Using ONLY facts from the Tempus Knowledge Base, write a short, professional rebuttal to the physician's concern. Be specific: cite product names (xF, xF+, xT CDx, xR), TATs (e.g., 7–9 days), and differentiators (tumor+normal, liquid biopsy when tissue is insufficient). Do not invent data.";

  const objectionUser = `Physician: ${provider.provider_name}
Clinic: ${provider.clinic_name}
Specialty: ${provider.oncology_subspecialty}
Estimated patient volume: ${provider.estimated_patient_volume}

CRM excerpt (contains the concern):
${provider.crm_excerpt ?? "No CRM notes"}

Tempus Knowledge Base:
${tempusKb}

Draft a 2–4 sentence objection-handling response.`;

  const pitchSystem =
    "You write 30-second elevator pitches for Tempus sales reps. Tone: professional, data-driven, empathetic. Use the physician's specialty and CRM context to personalize. Weave in 1–2 specific Tempus differentiators from the Knowledge Base (e.g., 7–9 day TAT for xF+, tumor+normal reducing false positives, liquid biopsy for insufficient tissue, RNA fusion detection). Write in second person and keep it around 80–100 words.";

  const pitchUser = `Physician: ${provider.provider_name}
Specialty: ${provider.oncology_subspecialty}
Estimated patient volume: ${provider.estimated_patient_volume}

CRM excerpt:
${provider.crm_excerpt ?? "No CRM notes"}

Tempus Knowledge Base:
${tempusKb}

Write the 30-second pitch script.`;

  const { client, model } = getLLM();

  const [objResp, pitchResp] = await Promise.all([
    client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: objectionSystem },
        { role: "user", content: objectionUser },
      ],
    }),
    client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: pitchSystem },
        { role: "user", content: pitchUser },
      ],
    }),
  ]);

  const objectionHandler =
    objResp.choices[0]?.message?.content?.trim() ?? "";
  const pitch = pitchResp.choices[0]?.message?.content?.trim() ?? "";

  const keyMetricsFromKb = await getPersonalizedKeyMetrics(
    client,
    model,
    provider,
    objectionHandler,
    pitch,
    tempusKb
  );

  return NextResponse.json({
    objectionHandler,
    pitch,
    keyMetricsFromKb,
  });
}

