// Actions Jarvis carries out when Tommy approves a request (the approval gate's "do it" step).
import { sendDraft } from "./gmail";
import { publishProduct } from "./printify";
import { replyInSaleshandy } from "./saleshandy";
import { createPaymentLink } from "./stripe";

export type ApprovalAction =
  | { type: "gmail_send"; draftId: string; to: string; subject: string; leadId?: number; body?: string }
  | { type: "stripe_payment_link"; name: string; amountUsd: number; monthly: boolean }
  | { type: "printify_publish"; productId: string; title: string }
  | { type: "saleshandy_reply"; threadId: string; emailId: string | null; to: string; body: string; leadId?: number }
  | { type: "phone_call"; callId: number }
  | { type: "trust_promote"; lane: import("@/lib/trust").Lane }
  | { type: "printify_production"; orderId: string; label: string }
  | { type: "listing_text"; productId: string; title: string; description: string; tags: string[]; holiday?: boolean };

export async function executeAction(a: ApprovalAction): Promise<string> {
  switch (a.type) {
    case "gmail_send": {
      const id = await sendDraft(a.draftId);
      if (a.leadId) {
        // An outreach reply: log it on the lead (loaded lazily to avoid a circular import).
        const { recordApprovedReply } = await import("@/lib/outreach/outreach");
        recordApprovedReply(a.leadId, id, a.subject, a.body ?? "");
      }
      return `Sent the email to ${a.to}: "${a.subject}".`;
    }
    case "printify_publish":
      return publishProduct(a.productId);
    case "saleshandy_reply": {
      try {
        await replyInSaleshandy(a.threadId, a.emailId, a.to, a.body);
      } catch (err) {
        return `Couldn't send it through Saleshandy (${err instanceof Error ? err.message : String(err)}). Copy the draft above and reply from Saleshandy's inbox.`;
      }
      if (a.leadId) {
        const { recordSaleshandyReply } = await import("@/lib/outreach/saleshandyReplies");
        recordSaleshandyReply(a.leadId, a.body);
      }
      return `Sent your answer to ${a.to} from Saleshandy.`;
    }
    case "listing_text": {
      const { updateListingText } = await import("./printify");
      return updateListingText(a.productId, a);
    }
    case "printify_production": {
      const { sendToProduction } = await import("./printify");
      return sendToProduction(a.orderId);
    }
    case "trust_promote": {
      const { setLaneAuto, LANES } = await import("@/lib/trust");
      setLaneAuto(a.lane, true);
      return `Autopilot is on for ${LANES[a.lane].label}: up to ${LANES[a.lane].dailyCap} a day, and you'll hear about each one.`;
    }
    case "phone_call": {
      const { placeApprovedCall } = await import("@/lib/calls/calls");
      return placeApprovedCall(a.callId);
    }
    case "stripe_payment_link": {
      const url = await createPaymentLink(a.name, a.amountUsd, a.monthly);
      return `Payment link for ${a.name} ($${a.amountUsd}${a.monthly ? "/month" : ""}): ${url}`;
    }
  }
}
