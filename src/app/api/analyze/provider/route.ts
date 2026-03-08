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

/** Extract key metrics from Tempus KB markdown for reps to reference. */
function extractKeyMetricsFromKb(kbText: string): string[] {
  if (!kbText?.trim()) return [];
  const lines = kbText.split(/\r?\n/);
  const metrics: string[] = [];
  let currentSection = "";
  const metricPattern = /(TAT|turnaround|%\d|genes?\s*\d|\d+\s*days?|weeks?|false.?positive|fusion|tumor|liquid|tissue|FDA)/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeader = /^#{1,3}\s+/.test(trimmed);
    if (isHeader) {
      currentSection = trimmed.replace(/^#+\s*/, "").trim();
      continue;
    }
    if (!trimmed || trimmed.startsWith("#")) continue;
    const isBullet = /^[-*•]\s*/.test(trimmed) || /^\d+\.\s*/.test(trimmed);
    const hasMetric = metricPattern.test(trimmed);
    if (currentSection && (isBullet || hasMetric) && (hasMetric || /\d+/.test(trimmed))) {
      const oneLiner = trimmed
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .replace(/\*\*/g, "");
      if (oneLiner.length > 10 && oneLiner.length < 200) {
        metrics.push(`${currentSection}: ${oneLiner}`);
      }
    }
  }
  return metrics.slice(0, 16);
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
  const keyMetricsFromKb = extractKeyMetricsFromKb(tempusKb);

  return NextResponse.json({
    objectionHandler,
    pitch,
    keyMetricsFromKb,
  });
}

