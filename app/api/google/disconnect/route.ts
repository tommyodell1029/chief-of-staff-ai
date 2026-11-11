// POST /api/google/disconnect — forget the Gmail connection.
import { disconnectGoogle } from "@/lib/integrations/gmail";

export const dynamic = "force-dynamic";

export async function POST() {
  disconnectGoogle();
  return Response.json({ ok: true });
}
