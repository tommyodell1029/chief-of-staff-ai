# Choose your AI model

Jarvis runs on **Claude** by default. You can switch the whole brain (Jarvis and every crew agent) to another provider
with a few settings in Render's **Environment** (or `.env.local` on your own computer). Switch back by removing
`AI_PROVIDER`.

| Option | Settings | Cost | Good for |
|---|---|---|---|
| **Claude** (default) | `ANTHROPIC_API_KEY` | Pay per use | Best results; the only option with built-in web search and page reading |
| **OpenRouter** | `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `AI_MODEL` | Pay per use, often cheaper | Trying other models with one key (openrouter.ai) |
| **Ollama** (local) | `AI_PROVIDER=ollama`, `AI_MODEL`, optional `OLLAMA_URL` | Free | Running fully on your own computer |

`AI_MODEL` is the model's name as the provider lists it (on OpenRouter, the ID on the model's page; on Ollama, the name
you pulled, e.g. after `ollama pull <model>`). Pick a model that supports **tool calling**, or Jarvis can't use his
tools. Optionally set one model per role: `AI_MODEL_SMART` (Jarvis himself), `AI_MODEL_WRITER` (writing agents) and
`AI_MODEL_FAST` (quick, high-volume work); any you leave out use `AI_MODEL`.

## What changes with another provider

- **No built-in web search or page reading.** Those are Claude features. Jarvis and the crews are told they're not
  available, so research-heavy jobs (the Prospector, the Growth Lab) do less.
- **Answers arrive in one piece** instead of word by word. Voice still works.
- **Quality varies by model.** Smaller local models make more mistakes with tools. The approval gate still protects
  anything that sends, spends or posts.
- **Costs:** OpenRouter reports each call's price, so the spend meter and caps keep working. Local models are free.

## Ollama only works where Ollama runs

Ollama runs on your own computer, so it only works when Jarvis also runs there (see
[moving-off-render.md](moving-off-render.md)). On Render, use Claude or OpenRouter.

**Connections → AI model** shows which brain is in use, and **"Jarvis, run diagnostics"** checks it.
