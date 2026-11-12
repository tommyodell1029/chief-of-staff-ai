# Setup

Two ways to set up your assistant:

- **Starter Kit (do it yourself):** follow the 8 setup videos. In short: make your private copy of this repository
  (GitHub → **Use this template** → Private), get an Anthropic API key with a monthly limit, deploy on Render (below),
  then sign in, name your assistant, and tell it what business you want to run (**Can you run this?**) or start from
  a crew template.
- **Done for you:** your assistant is set up from a **setup file** (a .json file) made from your kickoff call. It
  holds your name, the assistant's name, personality and voice, your businesses and what each one needs, and your
  outreach plan.

## 1. Accounts (in your name, on your card)

- **Render** (hosting, about $7/month): render.com.
- **Anthropic** (the AI, pay as you go): console.anthropic.com → API key. Or OpenRouter (see choose-your-model.md).
- **ElevenLabs** (the voice): elevenlabs.io → API key. Design your voice with Voice Design; copy its voice ID.
- For outreach: a separate sending domain, Google Workspace mailboxes on it, and Saleshandy.

If someone is building it for you, invite them to these accounts as a team member or admin. Never send passwords
or keys by email or text.

## 2. Deploy on Render

1. Render → **New → Blueprint** → connect this repository.
2. Render reads `render.yaml` and asks for: `TZ` (your time zone, e.g. `America/New_York`), `JARVIS_PASSWORD`
   (the password you'll sign in with), `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and your
   city. Leave the optional ones blank for now.
3. **Apply**. The first build takes a few minutes.

## 3. Finish setup

1. Open your assistant's address and sign in.
2. Tap **Finish setup**. Starter Kit: fill in your name, what to call you and your assistant's name, then press
   **Start** and add a business (**Can you run this?** or **Crew templates**). Done for you: choose the setup file
   instead. Either way, every crew waits for Launch.
3. **Connections**: connect Google (Gmail and Calendar), Telegram if you want it, and anything else your businesses
   use.

## 4. Launch

Open **Launch**. Each item shows what's left (for outreach, the mailboxes need about 3 weeks of warm-up first).
When everything required is green, press **LAUNCH**: the crews start working and outreach goes live. **Pause
everything** stops it any time.

## Adding a business later

Get an updated setup file and import it on **Setup**: your existing businesses stay, new ones are added. Then Launch
again.
