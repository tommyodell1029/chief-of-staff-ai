# Installing Jarvis on a Windows PC

> **Not needed right now.** Jarvis currently runs on Render ([render-setup.md](render-setup.md)). Use this guide later, when you get a computer that can stay on and online. To move an existing Jarvis (with all his data) from Render, follow [moving-off-render.md](moving-off-render.md), which uses steps 1–4 of this guide.

This sets Jarvis up on a Windows computer, such as an all-in-one. Expect about 20 minutes. Do the steps in order, and copy-paste every command exactly.

You'll need your **Anthropic API key**, **ElevenLabs API key** and **ElevenLabs voice ID** (see step 5).

---

## Step 1: Install Node.js (runs Jarvis)

1. Go to https://nodejs.org and click the big **LTS** download button (the Windows Installer, `.msi`).
2. Run it and click **Next** through everything, keeping the defaults.
3. Leave the box **"Automatically install the necessary tools"** *unchecked*. Jarvis doesn't need it.

## Step 2: Install Git (downloads Jarvis and pulls future updates)

1. Go to https://git-scm.com/download/win. The download starts by itself.
2. Run it and click **Next** through everything, keeping the defaults.

## Step 3: Open Command Prompt

Press the **Windows key**, type `cmd`, and press **Enter**. A black window opens.

> Use **Command Prompt**, not PowerShell. PowerShell often blocks `npm` with a "running scripts is disabled" error.

Check that the installs worked. Paste this and press Enter:

```bat
node -v && git --version
```

You should see two version numbers, like `v24.x.x` and `git version 2.x`. If you get "not recognized", close Command Prompt, open a new one, and try again.

## Step 4: Download Jarvis

Paste:

```bat
git clone https://github.com/YOUR-GITHUB/chief-of-staff-ai.git C:\jarvis
```

The repo is private, so a **GitHub sign-in window** pops up. Sign in, and the download continues.

> This puts Jarvis in `C:\jarvis`. Don't put it in Documents or Desktop: OneDrive syncs those folders and can corrupt the database.

Then go into the folder and install Jarvis's parts (takes 1–3 minutes):

```bat
cd C:\jarvis
npm install
```

Some yellow `warn` lines are normal. Red `ERR!` lines are not; see *Troubleshooting* below.

## Step 5: Add your keys

Make your private settings file and open it in Notepad:

```bat
copy .env.example .env
notepad .env
```

Fill in the three lines after the `=` sign, with no spaces or quotes:

| Line | Where to get it |
| --- | --- |
| `ANTHROPIC_API_KEY=` | https://console.anthropic.com/settings/keys → **Create Key**. It starts with `sk-ant-`. You'll need to add a few dollars of credit under **Billing**. |
| `ELEVENLABS_API_KEY=` | https://elevenlabs.io/app/settings/api-keys |
| `ELEVENLABS_VOICE_ID=` | ElevenLabs → **Voices** → your Jarvis voice → **Copy voice ID** |

Change `TZ=America/Chicago` to your own time zone if it's different (for example `America/New_York`). Then click **File → Save** and close Notepad.

## Step 6: Tell Jarvis about yourself

```bat
notepad data\about-tommy.md
```

Delete the placeholder comment, paste your About Tommy profile, then save and close. You can update it any time.

## Step 7: Start Jarvis

```bat
npm run dev
```

Wait for **✓ Ready**. If Windows asks whether to let Node.js through the firewall, tick **Private networks** only and click **Allow**.

On the all-in-one, open **http://localhost:3000** in Chrome or Edge.

**The mic works right away here**, because it's `localhost`. Hold the mic button and talk, and allow the microphone when the browser asks.

> **Keep the Command Prompt window open.** Closing it stops Jarvis. To stop him on purpose, click the window and press **Ctrl + C**.

Now run through `docs/phase-1-test-checklist.md` (sections A, B, C and E work right here on the all-in-one).

---

## Starting Jarvis again later

Open Command Prompt, then:

```bat
cd C:\jarvis
npm run dev
```

## Getting updates (when a new phase is ready)

Stop Jarvis (**Ctrl + C**), then:

```bat
cd C:\jarvis
git pull
npm install
npm run dev
```

Your keys (`.env`), profile and memories (`data\`) are kept.

---

## Using Jarvis from the iPad

On the iPad, typing works on your home Wi-Fi without any setup. Look for the **Network** address that `npm run dev` prints, like `http://192.168.1.50:3000`. The **mic**, though, needs https, so set up Tailscale using the **Windows** steps in [`tailscale-setup.md`](tailscale-setup.md). The short version:

1. Install Tailscale from https://tailscale.com/download/windows and log in from the tray icon.
2. In the Tailscale admin page under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
3. With Jarvis running, open a **second** Command Prompt and run:
   ```bat
   tailscale serve --bg 3000
   ```
   If it says "not recognized", use `"C:\Program Files\Tailscale\tailscale.exe" serve --bg 3000` instead.
4. Install Tailscale on the iPad, log in with the same account, then open the `https://….ts.net` address it printed.

**Keep the PC awake** while you use Jarvis from the iPad: **Settings → System → Power → Screen and sleep → "When plugged in, put my device to sleep after" → Never.**

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `'node'` or `'git'` is not recognized | Close Command Prompt and open a new one. If it still fails, rerun that installer. |
| `running scripts is disabled on this system` | You're in PowerShell. Use **Command Prompt** (`cmd`) instead. |
| `npm install` fails with red errors mentioning `better-sqlite3` or `gyp` | Rerun the Node.js installer and **tick** "Automatically install the necessary tools", let it finish, then run `npm install` again. |
| `EADDRINUSE: address already in use :::3000` | Jarvis is already running in another window. Use that one, or close it first. |
| Top bar says **No Anthropic key** or **Voice off** | Check `.env` (step 5): no spaces, no quotes. Save it, then stop and restart Jarvis. |
| GitHub sign-in didn't pop up / "Repository not found" | Make sure you're signed in to GitHub as the account that owns the repository, then run the `git clone` line again. |
