# Jarvis station on the all-in-one PC

The PC becomes an always-on Jarvis screen: the HUD (clock, to-dos, calendar, money, crew updates) with hands-free voice. Say **"Jarvis, what's the weather?"** from across the room and he answers out loud. Jarvis's brain stays on Render, so the PC only runs one browser window (about 300–500 MB of its 4 GB).

## How it behaves

- **"Jarvis, …"** with a question: sent right away.
- **"Jarvis"** on its own: a chime, then your next sentence is the question.
- **Follow-ups:** for about 7 seconds after he answers, you can keep talking without saying "Jarvis".
- While he thinks or talks, he only listens for **"Jarvis, stop"** (also "that'll be all", "that's enough", "never mind", "hold on"). Anything else he hears then, including his own voice, is ignored.
- **Tap the circle** to stop him mid-answer, or to ask something without saying "Jarvis".
- When a request needs a moment, he says so first (*"Right away, sir."*), and the strip shows what he's doing: *› Checking the weather*, *› Searching your inbox*, *› Running diagnostics*.
- **Mic off** button: stops listening completely (remembered until you turn it back on).
- It reconnects by itself if the internet drops, and refreshes itself every 6 hours while idle.

## He knows when you come and go

- **"Jarvis, I'm heading out"** — what's waiting on you, the weather, what's due; then the station goes quiet until you're back.
- **"Jarvis, I'm home"** (or just talk to the station when you get back) — *"Welcome back, sir. While you were out: two Etsy orders, about 110 dollars; an audit request from River City Plumbing… One thing is waiting for your OK."* Also after 3+ hours without talking to it.
- **First time you talk to it each morning** — *"Good morning, sir. It's 68 and clear, high of 81. First up: dentist at 3."* plus anything that came in overnight.
- **"Goodnight, Jarvis"** — tomorrow's first event and weather, then quiet until 7 am.
- **"Jarvis, focus mode"** (or "focus for 30 minutes") — quiet, then *"Focus time's over, sir."*
- **"Status report"** — AI spend, each crew's work, goals that are behind, what's waiting.

These work from your phone too ("I'm heading out" on the way to the truck).

## Systems check

- **"Jarvis, run diagnostics"** (or "systems check", "is everything working?"): he checks every system (brain and AI spending, voice, memory and disk, crews, scheduler, Gmail, Etsy, Printify, Stripe, Saleshandy, phone line, Maps, weather, image studio, Instagram) and reports like a ship's computer: *"14 of 16 systems online. Instagram is offline, awaiting its token."*
- When the station starts, a boot readout shows each system coming online, then fades. It shows once per window (not on the automatic 6-hour refresh).

## Sensing (optional)

Tap **Sensing off** to turn it on. The webcam then watches for movement (at a tiny resolution, inside the browser: no picture is saved or sent). When you sit down after being away, he greets you on his own with the catch-up, the same as if you'd said "Jarvis". Mornings get the good-morning brief.

- Only after 5+ minutes with nobody moving, and never between 11 pm and 5 am.
- The camera light stays on while sensing is on. A pet or a TV in view can count as movement; point the camera at your chair.
- Tap **Sensing on** to turn it off. The setting is remembered.

## The core and sounds

The circle on the strip and the big core on the HUD show what he's doing: a slow glow when idle, brighter and opening up when listening, a scanning sweep when looking through the camera, fast-spinning rings when thinking, ripples when he speaks, dim when the mic is off, amber when something failed (a post, a call, autopilot) until you talk to him or 90 seconds pass. Your businesses orbit the big core with their goal progress (orange = a goal is behind).

Sounds: a soft rising tone when the station opens, a chirp when he hears you, a two-note bell for alerts and a single soft note for small heads-ups (weather, calendar), a quiet shutter for camera photos. No sounds in quiet hours except ones you trigger.

## Show him things (webcam)

- Say **"Jarvis, what's this?"**, "look at this", "can you read this label?", "is this ripe?", "how do I look?": the station takes **one photo** with the webcam and sends it with your question.
- Or tap **📷 Show Jarvis**, hold the thing up, and ask your question (no "Jarvis" needed). If you don't ask anything, he tells you what he sees.
- The camera is on only for that one snapshot (about a second), then off. The photo shows on the strip so you know what he saw. Photos are kept in your Jarvis conversation like phone photos.
- The first time, Edge asks to use the **camera**: tap **Allow**. If you said no, open Edge normally → `edge://settings/content/camera` → allow `your-assistant.onrender.com`.
- Cost: a photo question costs a little more than a normal one (about 1–2¢).

## He speaks up on his own

The station says things out loud without being asked (and shows them on the bottom strip):
- **Everything that alerts your phone:** reminders, call results, Saleshandy "yes" replies, mailbox problems, Printify order problems, finished approvals.
- **Something new waiting for your OK** ("Sir, something needs your OK: …"). Bursts are grouped.
- **Your morning, lunch and evening briefings**, read out when they're ready.
- **Meetings:** "Sir, the dentist starts in 15 minutes."
- **New Etsy orders:** "Sir, a new Etsy order just came in: Custom Photo Blanket, 55 dollars."
- **Rain or storms** coming in the next few hours (once a day, 7 am–7 pm).

**Quiet hours** (shown, not spoken): every night 9 pm–7 am, Monday–Friday 7:45 am–5:15 pm while you're at work, and on weekends until you first talk to the station that day ("Jarvis…" or a tap). Change them with `STATION_QUIET` in Render, e.g. `21:00-07:00; Mon-Fri 07:45-17:15; Sat,Sun until-awake` (windows separated by `;`, days optional, 24-hour clock). **Announcements on/off** button: off = shown only. After he speaks, you have a few seconds to answer without saying "Jarvis".

Privacy: the wake word uses the browser's built-in speech recognition. In Edge that's Microsoft's online speech service, so while the mic is on, what the room says is sent to Microsoft to listen for "Jarvis". Use **Mic off** when you want privacy.

## Setup (about 10 minutes)

### 1. Make the shortcut
1. Right-click the desktop → **New → Shortcut**.
2. Paste this as the location (one line):
   ```
   "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=https://your-assistant.onrender.com/station --start-fullscreen --autoplay-policy=no-user-gesture-required
   ```
3. **Next**, name it `Jarvis Station`, **Finish**.
4. Double-click it. Sign in with your Jarvis password (once; it stays signed in for a year).
5. When Edge asks to use the **microphone**, tap **Allow**.
6. Say "Jarvis, what time is it?" to test.

### 2. Start it with Windows
1. Press **Windows key + R**, type `shell:startup`, press Enter.
2. Copy the `Jarvis Station` shortcut into that folder.

### 3. Keep the PC awake
1. **Settings → System → Power** (or "Power & battery") → **Screen and sleep**.
2. "When plugged in, put my device to sleep after": **Never**.
3. "Turn off my screen after": **Never** (or 30 minutes if you'd rather it go dark; it still listens).

### 4. Pick the right mic and speakers
**Settings → System → Sound**: choose the PC's microphone under **Input** and its speakers under **Output**, and turn the volume up.

### Optional: start after a restart without signing in
Windows Update restarts the PC sometimes. To have the station come back by itself: press **Windows + R**, type `netplwiz`, untick "Users must enter a user name and password", and enter your password. Only do this if the PC stays at home.

## If something's off

| You see | Fix |
|---|---|
| "Allow the microphone for this site" | Open Edge normally, go to `edge://settings/content/microphone`, move `your-assistant.onrender.com` to **Allow**, then reopen the shortcut. |
| "Tap anywhere to start Jarvis" | The shortcut is missing `--autoplay-policy=no-user-gesture-required`. Tap once, or fix the shortcut. |
| "Wake word needs Edge or Chrome" | The shortcut isn't opening Edge. Check the path in step 1. |
| He hears "Jarvis" from the TV | Tap **Mic off** while the TV's on, or lower the TV. |
| He doesn't react to "Jarvis" | Check the input mic in Windows Sound settings; speak toward the PC. |

To leave full screen, press **F11** or **Alt + F4** to close the window.
