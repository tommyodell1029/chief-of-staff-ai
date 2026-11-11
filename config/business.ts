// Tommy's business setup, shared by the Growth Lab and every crew. Edit this file to change the big picture.
// Full reasoning and sources: docs/business-plan.md and docs/research/.
import { MODELS } from "./models";

export const BUSINESS_CONTEXT = `Owner and businesses: filled in from the setup file.

Hard rules for everyone:
- Nothing is sent, spent, posted, signed or deleted without Tommy's approval (or a standing rule he approved).
- Follow each platform's rules; label AI-generated content where required; no spammy auto-DMs or mass posting.
- No income claims or "replaces your staff" claims (FTC); outbound calls/texts only with prior consent (TCPA).
- Be honest: call out hype, never promise income, give evidence and a confidence level.`;

// Placeholders: the original owner's agency and creator crews. Client assistants (KIT_MODE=1) never create these.
export const AGENCY_NAME = "Agency";
export const AGENCY_OLD_NAMES: string[] = [];
export const AGENCY_NOTES = "";
export const AGENCY_JOBS: Record<string, string> = { Prospector: "", "Outreach Writer": "", "Client Success": "", "Audit Desk": "" };
export const NINA_NOTES = "";
export const NINA_JOBS: Record<string, string> = {};
export const NINA_OLD_TEXT: { notes: string[]; jobs: Record<string, string[]> } = { notes: [], jobs: {} };
export const AGENCY_OLD_TEXT: { notes: string[]; jobs: Record<string, string[]> } = { notes: [], jobs: {} };

export type AgentModel = "writer" | "worker";
export const AGENT_MODELS = { writer: MODELS.writer, worker: MODELS.worker };

export interface AgentTemplate {
  name: string;
  job: string;
  model: AgentModel;
  tools: CrewTool[];
  autonomy: "approval_required" | "standing_rules";
}

// Tools a crew agent may be given. Nothing here can act in the outside world on its own:
// anything that would send, spend or post becomes an approval request for Tommy.
// email_draft: saves a Gmail draft and asks Tommy to approve sending it. create_post: makes a Nina Studio post for approval.
// add_leads: adds companies to an outreach campaign; Jarvis then finds each decision-maker's email (Apollo/Hunter).
// create_listing: makes an Etsy listing from a Printify template (published after approval, or automatically if Tommy turned that on).
// maps_search: searches Google Maps (Places API) and returns businesses in Google's order with rating, reviews, website.
export type CrewTool = "web_search" | "save_note" | "request_approval" | "email_draft" | "create_post" | "add_leads" | "create_listing" | "maps_search";
export const CREW_TOOLS: CrewTool[] = ["web_search", "save_note", "request_approval", "email_draft", "create_post", "add_leads", "create_listing", "maps_search"];

// Tools added to existing crews when Jarvis gains a new ability (applied once at startup).
export const TOOL_UPGRADES: { agent: string; tool: CrewTool }[] = [
  { agent: "Content Planner", tool: "create_post" },
  { agent: "Prospector", tool: "add_leads" },
  { agent: "Shop Marketer", tool: "create_listing" },
  { agent: "Outreach Writer", tool: "email_draft" },
  { agent: "Customer Care", tool: "email_draft" },
  { agent: "Client Success", tool: "email_draft" },
  { agent: "Client Success", tool: "web_search" },
  { agent: "Prospector", tool: "maps_search" },
  { agent: "Audit Desk", tool: "maps_search" },
];

export interface CrewTemplate {
  name: string;
  notes: string;
  agents: AgentTemplate[];
}

export const STARTER_CREWS: CrewTemplate[] = [];
