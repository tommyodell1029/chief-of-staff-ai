# Connecting Jarvis to your accounts

Everything here is free except Gemini images (about 4¢ each, pay-per-use, no subscription). Paid upgrades for lead finding are optional and noted.
Keys always go in **Render → your jarvis service → Environment**. Never paste them into Jarvis's chat.
After saving, Jarvis restarts by himself (about 1–2 minutes). Then open **Connections** in Jarvis to check each one.

> Why not use the Stripe/Gmail connectors in your Claude account? Those work only inside Claude's own apps. Jarvis runs on his own server, so he needs his own connection to each service.

---

## 1. Stripe: sales in your tiles (about 3 minutes)

1. Go to **dashboard.stripe.com → Developers → API keys → Create restricted key**.
2. Name it `Jarvis` and set these permissions (everything else stays **None**):
   - **Charges and Refunds:** Read
   - **Customers:** Read
   - **Subscriptions:** Read
   - **Products:** Write, **Prices:** Write, **Payment Links:** Write *(only used when you approve a payment link)*
3. Create it and copy the key (it starts with `rk_live_`). Use `rk_test_` from Test mode if you want to try it on fake data first.
4. In Render, add `STRIPE_API_KEY` = that key.

What you get:
- The agency tile and Wealth tile show Stripe money this week and your monthly recurring revenue automatically.
- You can ask "how much did we make this week?"
- "Make a $449/month payment link for Map Pack Pro" puts an approval on your dashboard, and the link is created only when you tap **Approve**.

Stripe money counts toward the **LaunchPad Local**. If another business bills through Stripe, set `STRIPE_BUSINESS` to part of its name.

## 2. Google: one project, one sign-in, one key (about 20 minutes, one time)

Everything Google lives in **one Google Cloud project** and gives Jarvis **two things**. Google always keeps "acting as you" (a sign-in) separate from "using Google's services" (a key), so it can't be fewer.

| What you paste into Render | What it gives Jarvis |
| --- | --- |
| **Sign-in:** `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | **Gmail** (read, search, drafts; sending only via approvals or approved campaigns), **Google Calendar** (read-only; replaces the iCal link), **Google Drive** (only files Jarvis creates, saved as Google Docs in a "Jarvis" folder) |
| **Key:** `GOOGLE_API_KEY` | **Gemini** (Nina's images and listing designs, ~4¢ each) and **YouTube** (real view counts for the Growth Lab's trend research, free) |

Because you have Google Workspace, the sign-in is a private **"Internal"** app, so Google doesn't need to review it. It only works for accounts in your Workspace.

### A. The project and its services
1. In Safari on the iPad, open **console.cloud.google.com** and sign in with your **Workspace** email (your business domain, not @gmail.com).
2. Project picker (top left) → **New project** → name `Jarvis` → **Create** → **Select project**. The top bar should say **Jarvis**.
3. Turn on these five services. For each one, type its name in the top search bar, open it, and tap **Enable**:
   - **Gmail API**
   - **Google Calendar API**
   - **Google Drive API**
   - **Generative Language API** (this is Gemini)
   - **YouTube Data API v3**

### B. The sign-in (Gmail + Calendar + Drive)
4. Menu (☰) → **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) → **Get started**:
   - App name `Jarvis`, user support email = yours → **Next**.
   - **Audience: Internal** → **Next**. This is the important part.
   - Contact email = yours → agree → **Create**.
5. **Data access → Add or remove scopes.** Search for and tick these, then **Update → Save**:
   - `.../auth/gmail.readonly`
   - `.../auth/gmail.compose`
   - `.../auth/calendar.readonly`
   - `.../auth/drive.file`
6. **Clients → Create client** → Application type **Web application** → name `Jarvis`.
   - **Authorized redirect URIs → Add URI:** `https://YOUR-JARVIS.onrender.com/api/google/callback` (your real Jarvis address; it must match exactly).
   - **Create.** Copy the **Client ID** and **Client secret** (keep that tab open until they're in Render).

### C. The key (Gemini + YouTube)
7. Billing first, because Gemini images need it: Menu → **Billing** → **Link a billing account** → add your card → link it to `Jarvis`.
   - Then **Billing → Budgets & alerts → Create budget**: $5/month, alerts at 50%, 90% and 100%.
8. Menu → **APIs & Services → Credentials → Create credentials → API key**. Copy it.
   - Tap the new key → **API restrictions → Restrict key** → tick **Generative Language API** and **YouTube Data API v3** → **Save**. This way the key can't be used for anything else.

### D. Put it in Jarvis
9. In Render → **Environment**, add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_API_KEY` → **Save Changes**. Wait for the restart (about 2 minutes).
10. Jarvis → **Connections → Connect Google** → pick your Workspace account → **Allow**.
    - The Google sign-in row should say **Gmail · Calendar · Drive**.
    - The Google key row should say **Gemini images · YouTube trends**.
11. If you'd set `GOOGLE_CALENDAR_ICS_URL` before, you can delete it now; the sign-in replaces it.

**If Google says the app is blocked:** you're the Workspace admin. In **admin.google.com → Security → Access and data control → API controls → Manage third-party app access**, find `Jarvis` and set it to **Trusted**.

**What it costs:**
- **Free:** Gmail, Calendar, Drive and YouTube.
- **Gemini images:** about 4¢ each. They're counted in Jarvis's spend meter and stopped by your monthly cap, and the Google budget alert is a second safety net.

**Left out on purpose:** Google Maps/Places for finding businesses. Google's terms limit storing that data, and a lead list is exactly that, so the Prospector uses web search instead.

## 3. (Merged into section 2)

Gemini now uses the Google key from section 2 (`GOOGLE_API_KEY`). An older `GEMINI_API_KEY` still works if you already set one. If Google renames the image model and images fail, set `GEMINI_IMAGE_MODEL` to the new name shown in AI Studio.

## 4. Instagram: auto-post Nina (about 20 minutes, one time)

1. In the Instagram app, logged in as Nina:
   - **Settings → Account type and tools → Switch to professional account → Creator**.
   - Also turn on the **AI-generated** profile label (Settings → Account → "AI info" / "AI-generated profile"). Since August 2026, unlabeled AI personas lose reach.
2. On **developers.facebook.com** (log in with any Facebook account you control):
   - **My Apps → Create app**. Use case: **"Manage messaging & content on Instagram."** Name it `Jarvis`.
   - In the app, open **Instagram → API setup with Instagram login**.
   - Under **Generate access tokens**, tap **Add account** and log in as **Nina's** Instagram, then **Generate token** and copy it.
   - Keep the app in **Development** mode. That's fine for posting to your own account, which has a role on the app.
3. In Render, add `IG_ACCESS_TOKEN` = that token.

Jarvis checks it on the **Connections** page (it shows `@nina…`) and refreshes the token every week, so it doesn't expire.

**How posting works:** in **Nina Studio**, tap **Approve & post** on a post that includes Instagram, and it's live in a few seconds.

**If Instagram says the permission isn't approved:** Meta sometimes requires the app's `instagram_business_content_publish` permission to be approved first. Send me the exact message and I'll walk you through that request. Until then, use **Share…**, which works today.

## 5. Nina's voice (optional, 2 minutes)

- In ElevenLabs, design or pick a voice for Nina (use the same Voice Design steps as for Jarvis, with a different description), then **Copy voice ID**.
- In Render, add `NINA_VOICE_ID`.

Posts with a voiceover script get an MP3 you can use in Reels and TikToks. It uses your ElevenLabs credits.

## 6. TikTok, Reddit and Fanvue

None of these let Jarvis post for you yet:
- **TikTok** keeps API posts private until an app passes their audit.
- **Reddit** now approves API access case by case.
- **Fanvue's** API is approval-only.

For now, approved posts land in **Nina Studio → Ready to share**:
1. Tap **Share…**. The image goes to the iPhone share sheet and the caption is copied.
2. Pick TikTok, Reddit or Fanvue, paste, and post.
3. Tap **Mark posted**.

Want Fanvue's API later? Apply at api.fanvue.com, and I'll add it once you're approved.

> Nina's NSFW content can't be made by Claude, Gemini or ElevenLabs. All three prohibit it, so that part stays outside Jarvis.

---

## 7. Etsy: sales, orders and reviews (about 5 minutes)

1. Go to **etsy.com/developers** (signed in as your shop) → **Create a new app**.
   - Choose the option for your **own shop** (a "Seller" or personal app). Etsy approves these automatically, usually within minutes.
   - App name `Jarvis`. Callback URL: `https://YOUR-JARVIS.onrender.com/api/etsy/callback`.
2. Open the app and copy the **Keystring**, plus the **Shared secret** if one is shown.
3. In Render, add `ETSY_API_KEY` = the keystring, and `ETSY_SHARED_SECRET` = the shared secret.
4. After the restart: Jarvis → **Connections → Connect Etsy → Allow access**.

What you get: Etsy sales this week show on the POD tile, and you can ask "how's the Etsy shop doing?" or "any new reviews?".

## 8. Printify: listings made for you (about 15 minutes)

Printify already moves Etsy orders to production automatically, once your Etsy shop is connected inside Printify (Printify → **My stores → Connect Etsy**). Jarvis adds listing creation and order alerts on top.

1. **Make one template per product type.** In Printify, create a product the normal way (for example, a mug or a canvas) with any photo, your print provider, sizes and prices.
   - Name it starting with `TEMPLATE`, e.g. `TEMPLATE Mug 11oz` or `TEMPLATE Canvas 12x16`.
   - Turn on **personalization** for Etsy (photo upload) in the product's settings, so buyers can upload their photo at checkout.
   - **Don't publish templates.** Jarvis copies them.
2. **Get a token:** Printify → **My Profile → Connections → Generate** a personal access token (all scopes). It lasts a year.
3. In Render, add `PRINTIFY_API_TOKEN`.

What you get:
- Tell the POD crew's **Shop Marketer** something like "make 5 pet-portrait listings for Christmas". It writes the title, tags and description, creates an example design with Gemini, and builds each listing from your template.
- Each listing comes to you as an approval showing a mockup. **Approve** publishes it to Etsy ($0.20 listing fee).
- To skip the approvals, tick **Publish listings without asking** on the Connections page.
- Orders that get stuck (on hold, problems, unpaid) send you a phone alert.

## 9. Apollo: decision-makers' emails (about 3 minutes)

> Your Claude account's Apollo/Hunter connectors only work inside Claude. Jarvis needs his own keys.

1. Sign in to **apollo.io** with a **work** email (Apollo's free plan blocks search for personal emails like Gmail).
2. **Settings → Integrations → API → Create new key** (give it access to search and enrichment).
3. In Render, add `APOLLO_API_KEY`.

The free plan includes roughly 75–100 email reveals a month. Searching for people is free; revealing an email costs 1 credit.

## 10. Hunter: backup finder and email verification (2 minutes)

1. **hunter.io → API** (left menu) → copy your API key.
2. In Render, add `HUNTER_API_KEY`.

The free plan includes about 25 searches and 50 verifications a month. Jarvis verifies **every** email before sending, and generic inboxes (info@, contact@, sales@…) are never used.

**Together, the free plans give you roughly 100 decision-maker emails a month.** If campaigns work and you want more, the paid plans are about $49/month each. Your call later.

## 11. Google Maps search for the Prospector (about 5 minutes)

The Prospector and Audit Desk search Google Maps the way a customer does and see each business's real map position, rating, review count, how recent the newest review is, hours and photos.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and pick your Jarvis project.
2. **APIs & Services → Library**, search **Places API (New)**, open it, and click **Enable**. (Not the older one just called "Places API".)
3. **APIs & Services → Credentials**, open your Jarvis API key. Under **API restrictions**, add **Places API (New)** to the list next to Gemini and YouTube, then **Save**.
4. Google requires a billing account on the project for this API. If it asks, link one under **Billing**. Jarvis caps itself at 25 searches a day and 900 a month (`MAPS_DAILY_LIMIT`, `MAPS_MONTHLY_LIMIT`), inside Google's roughly 1,000 free searches a month, so the bill stays at $0.
5. Optional safety net: **Billing → Budgets & alerts → Create budget** of $1 with an email alert.

Check: the Connections page shows **Google Maps search** with a counter.

## 12. Saleshandy: owners' emails and your sequence (about 5 minutes)

1. In Saleshandy, go to **Settings → API Key** (sometimes under **Integrations**), create a key, and copy it.
2. In Render, go to **Environment** and add `SALESHANDY_API_KEY` with that key, then **Save** (it redeploys).
3. In Saleshandy, create the sequence the leads will go into (your free-audit email + 2 follow-ups), connect your mailbox to it, and set its sending schedule and daily limit there.
4. In Jarvis, go to **Outreach → New campaign**, write who to find, and pick **Send with: Saleshandy: (your sequence)**. Approve it.

What happens next: the Prospector finds businesses on Google Maps, Jarvis finds each owner with Saleshandy Lead Finder (Apollo, then Hunter, if Saleshandy finds no one), and leads with a verified email go into the first step of your sequence, tagged "Jarvis". Saleshandy re-verifies each email and does the sending, follow-ups and replies. Revealing an email uses about 1 Lead Finder credit; Jarvis stops at 30 a day (`SALESHANDY_DAILY_REVEALS`).

Don't also run a Gmail campaign on the same leads, or they'll get two emails.

**Replies back to Jarvis (1 tap):** on the Connections page, tap **Saleshandy → Connect replies**. Saleshandy then tells Jarvis about every reply, bounce, unsubscribe and mailbox problem as it happens:
- **Yes / send the audit:** the Audit Desk starts the free audit, you get a 🔥 alert, and a short "on its way" reply waits for your approval.
- **A question:** Jarvis researches and drafts an answer; approve it and it's sent from Saleshandy in the same thread.
- **No / unsubscribe / bounce:** the lead is updated; Saleshandy stops the sequence for them.
- **Mailbox disconnected or sequence paused:** phone alert.

## 13. Google Weather for Jarvis (2 minutes)

1. In Google Cloud (Jarvis project), **APIs & Services → Library**, search **Weather API**, and **Enable** it.
2. **APIs & Services → Credentials**, open your Jarvis API key, and add **Weather API** under **API restrictions**. **Save**.
3. Ask Jarvis "What's the weather?" He uses Google Weather for home (`HOME_CITY`, `HOME_REGION`) or any place you name, and the morning briefing uses it too. Each question uses up to 3 calls, cached 10 minutes, capped at 60 calls a day (`WEATHER_DAILY_LIMIT`). If Google refuses, he falls back to web search.

