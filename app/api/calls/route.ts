// GET /api/calls — recent phone calls with results, plus whether calling is set up.
import { callsConfigured, listPhoneNumbers } from "@/lib/integrations/elevenAgents";
import { inCallingHours, listCalls } from "@/lib/calls/calls";

export const dynamic = "force-dynamic";

export async function GET() {
  let number: string | null = null;
  let problem: string | null = null;
  if (callsConfigured()) {
    try {
      number = (await listPhoneNumbers())[0]?.phone_number ?? null;
      if (!number) problem = "No phone number imported into ElevenLabs yet.";
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
  } else problem = "ELEVENLABS_API_KEY isn't set.";
  return Response.json({ calls: listCalls(50), number, problem, callingHours: inCallingHours() });
}
