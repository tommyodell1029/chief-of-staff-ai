# Chief of Staff AI

A personal AI assistant that runs your business with you: you name it, give it a voice, and it manages a crew of
AI agents for each of your businesses (outreach, Google Maps visibility, Etsy, social content, everyday help).
Nothing is sent, spent or posted without your approval.

## What it does

- **Talks with you** by voice or text, from your phone, a desk "station" screen with a wake word (its name), or
  Telegram. Daily briefings, to-dos, memory, calendar and email.
- **Tells you if it can run your business idea.** Describe what you want to run; it researches demand, competition,
  costs and rules, then says honestly whether its crews can run it (yes, partly or no), what you'd still do yourself,
  and the first steps. Say yes and it builds the crew.
- **Runs crews** for each business. Agents hand work to each other, ask you quick multiple-choice questions when
  unsure, and work overnight within a budget (Night Shift). Watch it live on the **Command Deck**.
- **Outreach** from a separate, warmed-up sending domain, with every email approved by you first.
- **Outbox** for everything finished: reports, lead lists, audits.
- **Your choice of AI**: Claude by default, or OpenRouter, or a free local model.

## Setup

1. Deploy to Render with this repository's `render.yaml` (or run it on your own computer).
2. Open it, sign in, **Finish setup**: name your assistant, then tell it what business you want to run
   (**Can you run this?**). Had a done-for-you kickoff call? Import the setup file from it instead
   ([docs/client-setup.md](docs/client-setup.md)).
3. Connect your accounts on **Connections**.
4. When the **Launch** screen is all green, press **LAUNCH**.

Your accounts, your data, your keys: everything runs on your own Render (or computer) with your own API keys.

## Guides

- [Client setup](docs/client-setup.md) · [Connections](docs/connections-setup.md) · [Command Deck](docs/command-deck.md)
- [Telegram](docs/telegram-setup.md) · [Choose your model](docs/choose-your-model.md) · [Run it on your own computer](docs/moving-off-render.md)
