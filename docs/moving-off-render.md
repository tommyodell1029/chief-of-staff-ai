# Moving Jarvis off Render

Right now Jarvis's brain runs on Render (about $7.25 a month: the Starter server plus the 1 GB disk). Moving him
to a computer at home saves that, but the computer has to stay **on and online 24/7**. When it's off, Jarvis is off:
no scheduled jobs (order checks, briefings, Monday review, outreach), no phone access, and the website's audit form
can't reach him.

## Should you move?

| | Render (now) | Home PC | Small cloud server (VPS) |
|---|---|---|---|
| Cost | ~$7.25/mo | $0 (plus power) | ~$5–6/mo |
| Stays up when the power or internet goes out | ✓ | ✗ | ✓ |
| Updates when I push code | Automatic | You run one command | You run one command |
| Setup | Done | ~1 hour | ~1–2 hours |

**My recommendation:** stay on Render until you have a computer that's on all day anyway. The Dell 3475 will run
Jarvis fine after the RAM upgrade, but it's also the station screen, and Windows updates restart it. If you want a
dedicated box later, a mini PC (Intel N100, 16 GB, about $150–200) running quietly in a closet is the best home option.

## How the move works (when you're ready)

Everything Jarvis knows lives in two places, and both move over:

1. **His data:** the database (memories, to-dos, crews, approvals, leads, clients, goals, connected-account
   tokens) and the media folder (Nina's images, voiceovers, reels). **Connections → Backup → Download backup**
   gives you all of it in one file.
2. **His keys:** the values in Render → your service → **Environment**. These are *not* in the backup, on purpose.
   You copy them yourself from Render onto the new computer. Never paste them into a chat.

### Step 1: Install Jarvis on the new computer (~20 min)

Follow [windows-setup.md](windows-setup.md) steps 1–4 (Node.js, Git, download Jarvis). Then, instead of
`npm run dev`, build the fast version once:

```bat
cd %USERPROFILE%\jarvis
npm ci
npm run build
```

### Step 2: Copy the keys (~10 min)

1. On Render, open your Jarvis service → **Environment**.
2. On the new computer, open the `jarvis` folder and create a file named `.env.local` (Notepad → Save as →
   "All files"). Put each Render variable on its own line, `NAME=value`, for example `ANTHROPIC_API_KEY=...`.
   Copy **every** variable except `DATA_DIR` (the new computer uses the `data` folder inside `jarvis`).
3. Add one more line: `PUBLIC_URL=` (filled in at step 4).

### Step 3: Move the data (~5 min)

1. In Jarvis on Render: **Connections → Download backup**. Save the file into the `jarvis` folder.
2. In Command Prompt:
   ```bat
   cd %USERPROFILE%\jarvis
   mkdir data
   tar -xzf jarvis-backup-YYYY-MM-DD.tar.gz -C data
   ```
   (Use the real file name.) You should now have `data\jarvis.db` and `data\media`.

Do this right before you switch, so nothing that happens on Render in between is lost.

### Step 4: Give the computer a public https address (~15 min)

Jarvis needs a public address for: your phone away from home, Instagram downloading Nina's images and reels, the
website's audit form, Saleshandy's reply webhook, and the Google/Etsy sign-in redirects.

Free option: **Tailscale Funnel** (see [tailscale-setup.md](tailscale-setup.md) steps 1–3 to install Tailscale and
turn on HTTPS). Then:

```bat
tailscale funnel --bg 3000
```

The first time, it prints a link to turn Funnel on for your Tailscale account: open it, approve, and run the command
again. It then prints an address like `https://dell-3475.tail1234.ts.net`. Put that in `.env.local` as
`PUBLIC_URL=...`.

### Step 5: Start Jarvis and keep him running (~10 min)

```bat
cd %USERPROFILE%\jarvis
npm start
```

Then open the address from step 4 and sign in. To start him automatically with Windows, add a Task Scheduler task
(**At startup**, run `cmd /c "cd /d %USERPROFILE%\jarvis && npm start"`). Also set **Settings → System → Power →
Sleep: Never**, and set Windows Update **active hours** to the daytime.

### Step 6: Point everything at the new address (~20 min)

The new address replaces `https://your-assistant.onrender.com` in:

- **Google Cloud** → your OAuth client → Authorized redirect URIs: add `NEW-ADDRESS/api/google/callback`.
- **Etsy app** (etsy.com/developers) → Callback URL: `NEW-ADDRESS/api/etsy/callback`.
- **Website form**: in `website/yourbusiness.com/index.html`, change `AUDIT_ENDPOINT` to
  `NEW-ADDRESS/api/public/audit-request` and upload the site to Netlify again (I can make this change for you).
- **Saleshandy replies**: Jarvis → Connections → Saleshandy → **Connect replies** again (it registers the new address).
- **Station shortcut** and your **phone's home-screen Jarvis**: open the new address and add it again.

### Step 7: Switch over

1. Check everything for a day: "Jarvis, run diagnostics", a test question by voice, a phone alert.
2. On Render: your service → **Settings → Suspend service**. Keep it suspended (not deleted) for a week, so you
   can switch back by resuming it.
3. After a good week, delete the Render service and its disk.

**Switching back** is the same move in reverse: download a backup from the home PC, resume Render, and restore the
backup there (I'll walk you through it).

## Updates after the move

When I push new features, on the home computer:

```bat
cd %USERPROFILE%\jarvis
git pull
npm ci
npm run build
```

Then restart Jarvis (close the window and run `npm start`, or restart the PC).
