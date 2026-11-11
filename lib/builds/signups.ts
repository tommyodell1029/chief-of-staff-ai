// Sign-ups from the Chief of Staff AI sales page (website/chief-of-staff-ai). Kept in settings ("cos_signups").
// A done-for-you application also starts a build card, so the kickoff call is the next step on /builds.
import { notifyAll } from "@/lib/push";
import { getSetting, setSetting } from "@/lib/settings";
import { createBuild } from "./builds";

export interface Signup {
  id: number;
  name: string;
  email: string;
  interest: "kit" | "done-for-you" | "updates";
  idea: string;
  at: number;
  buildId?: number;
  handled?: boolean;
}

const KEY = "cos_signups";
export function listSignups(): Signup[] {
  try {
    return JSON.parse(getSetting(KEY) || "[]") as Signup[];
  } catch {
    return [];
  }
}
const save = (rows: Signup[]) => setSetting(KEY, JSON.stringify(rows.slice(0, 500)));

export async function addSignup(s: Omit<Signup, "id" | "at" | "buildId">): Promise<Signup> {
  const rows = listSignups();
  const dupe = rows.find((r) => r.email === s.email && r.interest === s.interest);
  if (dupe) return dupe;
  const row: Signup = { ...s, id: Math.max(0, ...rows.map((r) => r.id)) + 1, at: Date.now() };
  if (s.interest === "done-for-you") {
    const b = createBuild(s.name, s.email);
    row.buildId = b.id;
  }
  save([row, ...rows]);
  const what = s.interest === "done-for-you" ? "applied for a done-for-you build" : s.interest === "kit" ? "joined the kit founding list" : "signed up for updates";
  await notifyAll({ title: `Chief of Staff AI: ${s.name} ${what}`, body: s.idea ? `Wants to run: ${s.idea.slice(0, 160)}` : s.email, url: "/builds", tag: `cos-signup-${row.id}` }).catch(() => {});
  return row;
}

export function markSignup(id: number, handled: boolean) {
  save(listSignups().map((r) => (r.id === id ? { ...r, handled } : r)));
}
