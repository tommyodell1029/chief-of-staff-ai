// PUT /api/studio/setup {persona} — Nina's look. POST {photo: dataURL} — add a reference photo. DELETE {name} — remove one.
import sharp from "sharp";
import { saveMedia } from "@/lib/media";
import { getRefs, setPersona, setRefs } from "@/lib/studio";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const { persona } = (await req.json().catch(() => ({}))) as { persona?: string };
  if (!persona?.trim()) return Response.json({ error: "Describe Nina first." }, { status: 400 });
  setPersona(persona.trim());
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  const { photo } = (await req.json().catch(() => ({}))) as { photo?: string };
  const m = photo?.match(/^data:image\/(?:jpeg|png|webp|heic|heif);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return Response.json({ error: "Unsupported photo" }, { status: 400 });
  if (getRefs().length >= 3) return Response.json({ error: "Up to 3 reference photos. Remove one first." }, { status: 400 });
  const jpeg = await sharp(Buffer.from(m[1], "base64")).rotate().resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
  const name = saveMedia(jpeg, "jpg", "ninaref");
  setRefs([...getRefs(), name]);
  return Response.json({ refs: getRefs() });
}

export async function DELETE(req: Request) {
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  setRefs(getRefs().filter((r) => r !== name));
  return Response.json({ refs: getRefs() });
}
