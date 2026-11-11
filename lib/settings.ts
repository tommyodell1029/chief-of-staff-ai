// Small saved settings (key/value).
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export function getSetting(key: string): string | undefined {
  return getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value;
}

export function setSetting(key: string, value: string) {
  getDb()
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
}
