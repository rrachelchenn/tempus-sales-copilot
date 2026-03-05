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

const store: {
  kb: string;
  providerByName: Map<string, ProviderRow>;
} = {
  kb: "",
  providerByName: new Map(),
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return new OpenAI({ apiKey });
}

export async function POST(req: NextRequest) {
  const { provider } = (await req.json()) as { provider: ProviderRow };
  if (!provider) {
    return NextResponse.json(
      { error: "Missing provider in request body." },
      { status: 400 }
    );
  }

  const openai = getOpenAI();

  const objectionSystem =
    "You are a Tempus sales expert. Using ONLY facts from the Tempus Knowledge Base, write a short, professional rebuttal to the physician's concern. Be specific: cite product names (xF, xF+, xT CDx, xR), TATs (e.g., 7–9 days), and differentiators (tumor+normal, liquid biopsy when tissue is insufficient). Do not invent data.";

  const objectionUser = `Physician: ${provider.provider_name}
Clinic: ${provider.clinic_name}
Specialty: ${provider.oncology_subspecialty}
Estimated patient volume: ${provider.estimated_patient_volume}

CRM excerpt (contains the concern):
${provider.crm_excerpt ?? "No CRM notes"}

Tempus Knowledge Base:
${store.kb}

Draft a 2–4 sentence objection-handling response.`;

  const pitchSystem =
    "You write 30-second elevator pitches for Tempus sales reps. Tone: professional, data-driven, empathetic. Use the physician's specialty and CRM context to personalize. Weave in 1–2 specific Tempus differentiators from the Knowledge Base (e.g., 7–9 day TAT for xF+, tumor+normal reducing false positives, liquid biopsy for insufficient tissue, RNA fusion detection). Write in second person and keep it around 80–100 words.";

  const pitchUser = `Physician: ${provider.provider_name}
Specialty: ${provider.oncology_subspecialty}
Estimated patient volume: ${provider.estimated_patient_volume}

CRM excerpt:
${provider.crm_excerpt ?? "No CRM notes"}

Tempus Knowledge Base:
${store.kb}

Write the 30-second pitch script.`;

  const client = getOpenAI();

  const [objResp, pitchResp] = await Promise.all([
    client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: objectionSystem },
        { role: "user", content: objectionUser },
      ],
    }),
    client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: pitchSystem },
        { role: "user", content: pitchUser },
      ],
    }),
  ]);

  function extractText(r: OpenAI.Beta.Responses.Response) {
    const first = r.output[0]?.content[0];
    if (first && first.type === "output_text") {
      return first.text;
    }
    return "";
  }

  return NextResponse.json({
    objectionHandler: extractText(objResp),
    pitch: extractText(pitchResp),
  });
}

