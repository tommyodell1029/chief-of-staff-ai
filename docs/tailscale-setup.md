# Tailscale setup: a private https address for the iPad mic

**Why:** iPad Safari only allows the microphone on `https://` pages. Tailscale is free for personal use (up to 100 devices, no card needed). It links your mini PC and iPad into a private network and gives Jarvis a real https address, like `https://minipc.tail1234.ts.net`, that only your own devices can open. It works at home and away from home.

Expect about 10 minutes. Do the steps in order.

---

## Step 1: Create your Tailscale account (any device)

1. Go to https://login.tailscale.com/start
2. Sign in with Google (`tommy.odell1029@gmail.com`) or any account you like. **Use the same login on every device.**

## Step 2: Install Tailscale on the mini PC

**If the mini PC runs Linux** (Ubuntu, Debian, and similar), open a terminal and paste:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

`tailscale up` prints a link. Open it in any browser, sign in, and approve the device.

Then let your normal user run Tailscale commands without `sudo` (paste exactly as written):

```bash
sudo tailscale set --operator=$USER
```

**If the mini PC runs Windows:**

1. Download and run the installer from https://tailscale.com/download/windows
2. Click the Tailscale icon in the system tray, choose **Log in**, and sign in with the same account.

## Step 3: Turn on HTTPS for your network (one time)

1. Open https://login.tailscale.com/admin/dns
2. Under **MagicDNS**, make sure it's **Enabled**.
3. Scroll to **HTTPS Certificates** and click **Enable HTTPS**.

## Step 4: Point Tailscale at Jarvis

Start Jarvis on the mini PC as usual (`npm run dev`, or `npm run build` then `npm start`). It listens on port 3000.

Then, in a **second** terminal on the mini PC (on Windows, PowerShell):

```bash
tailscale serve --bg 3000
```

It prints your address, something like:

```
Available within your tailnet:
https://minipc.tail1234.ts.net/
|-- proxy http://127.0.0.1:3000
```

**Copy that `https://…ts.net` address.** `--bg` means it keeps running, including after a reboot. You only do this once.

> If it says HTTPS isn't enabled, it will show a link. Open it, approve, and run the command again.

## Step 5: Install Tailscale on the iPad

1. Install **Tailscale** from the App Store.
2. Open it, tap **Log in**, and use the **same account**.
3. When iOS asks to add a VPN configuration, tap **Allow**. Tailscale only routes traffic for your own devices; the rest of your internet is untouched.
4. Make sure the switch at the top shows **Connected**.

## Step 6: Open Jarvis on the iPad

1. In Safari, go to your `https://…ts.net` address from step 4.
2. Tap the mic. When Safari asks to use the microphone, tap **Allow**.
3. Tap **Share → Add to Home Screen**, so Jarvis opens full-screen from now on.

Then run section C (voice) and section D (iPad layout) of `docs/phase-1-test-checklist.md`.

---

## If something doesn't work

| Problem | Fix |
| --- | --- |
| The page won't load on the iPad | Make sure the Tailscale app on the iPad shows **Connected**, and that Jarvis is running on the mini PC (`http://localhost:3000` works there). |
| "This site can't provide a secure connection" | HTTPS Certificates isn't on yet (step 3). The very first load can take ~30 seconds while the certificate is issued. Wait, then refresh. |
| The mic button says it needs https | You opened the `http://192.168…` address. Use the `https://…ts.net` one. |
| The mic was blocked by accident | iPad **Settings → Apps → Safari → Microphone**, set to **Ask** or **Allow**, then reload. |
| Check what Tailscale is serving | On the mini PC: `tailscale serve status` |
| Stop sharing Jarvis | On the mini PC: `tailscale serve reset` |

**Privacy note:** this does **not** put Jarvis on the public internet. Only devices signed in to your Tailscale account can reach the address. Don't use `tailscale funnel`, which *would* make it public.
