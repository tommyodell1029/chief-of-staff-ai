# Telegram: talk to Jarvis and approve things from Telegram (optional, free)

Once connected you can message Jarvis in Telegram like a text chat, and his alerts arrive there too, with buttons:
**Approve / Deny** on approvals and one button per answer on the crew's quick questions.

## 1. Make the bot (3 minutes)

1. In Telegram, search for **@BotFather** (the official one, blue check) and open it.
2. Send `/newbot`.
3. Give it a name, e.g. `Jarvis`, then a username ending in `bot`, e.g. `TommysJarvisBot`.
4. BotFather replies with a **token** like `123456789:AA...`. Keep it private.

## 2. Add the token to Render (2 minutes)

1. Render → your Jarvis service → **Environment** → **Add Environment Variable**.
2. Key: `TELEGRAM_BOT_TOKEN`, value: the token. **Save changes** and wait for the redeploy (about 3 minutes).

## 3. Connect (1 minute)

1. Jarvis → **Connections** → **Telegram** → **Connect**.
2. Tap **Open @YourBot in Telegram and tap Start**. Telegram opens with your private start code; tap **Start**.
3. Jarvis replies "Connected, sir."

The code works once, for 15 minutes. Only the chat that used it can talk to Jarvis; messages from anyone else are
ignored. To stop, tap **Disconnect** on Connections.

## Notes

- Text messages only for now (no voice notes or photos).
- Night Shift holds the same alerts in Telegram as on your phone until the morning report.
- If you move Jarvis off Render, tap **Connect** again so Telegram learns the new address.
