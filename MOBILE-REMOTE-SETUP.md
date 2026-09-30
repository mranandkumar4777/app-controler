# Controlling Presenter from your phone

This adds a phone remote for the Presenter app. It needs one small local
server running on the same computer as Presenter — a web page can't accept
incoming connections on its own, so `server.js` is what bridges that gap.
No internet connection is needed; your phone just needs to be on the same
Wi-Fi as the computer.

## What's here

- `presenter.html` — the app itself (updated to talk to the server when it's running).
- `server.js` — a small local server. Requires Node.js, no other install needed.
- `remote.html` — the mobile-friendly remote page, served by server.js.

Put all three files in the **same folder**.

## One-time setup

1. If you don't already have it, install **Node.js** (free) from
   https://nodejs.org — the "LTS" version is fine.

## Easiest way (recommended)

Start Presenter with `Presenter.bat` / `Presenter.app` / `presenter.sh` (see START-HERE.md),
then click the **📱 Phone** button at the top of the Presenter window. It shows a
**QR code** — scan it with your phone camera and the remote opens already signed in.
The link and PIN are shown there too if you'd rather type them.

The Phone button only shows the link when Presenter was opened from
`http://localhost:8787/` (which the launchers do for you). If you just
double-click `presenter.html`, it will tell you the server isn't running.

## Manual way (every time you want phone control)

1. Open a terminal / command prompt in the folder with these three files.
2. Run:
   ```
   node server.js
   ```
3. It will print something like:
   ```
   PIN (needed once per phone): 483920

   On this computer, open the Control window at:
     http://localhost:8787/

   On your phone (same Wi-Fi network), open:
     http://192.168.1.23:8787/remote
   ```
4. **On the computer**: open `http://localhost:8787/` in your browser for the
   Control window (instead of double-clicking presenter.html). This matters —
   it's what lets Control hear commands from your phone, and it picks up the
   PIN automatically since it's the same trusted computer.
5. **On your phone**: open the `http://192.168.1.23:8787/remote` address
   (using whatever number the terminal actually printed) in its browser.
   The first time, it'll ask for the PIN — type in the 6-digit number from
   the terminal. It's remembered after that, so you won't need to enter it
   again on that phone (unless you change the PIN — see below).
   You can add the page to your phone's home screen for one-tap access next time.
6. Leave the terminal window open the whole time you want the phone connected.
   Closing it disconnects the phone (Presenter itself keeps working normally).

## About the PIN

The PIN keeps random people on the same Wi-Fi from being able to control
your screen — only people you've actually told the PIN to can connect.
It's saved in a file called `.remote-pin` next to server.js, so it stays
the same every time you restart the server (no need to re-enter it on
phones that already know it). To change it: delete `.remote-pin`, or start
the server with a PIN of your choosing:
```
PIN=112233 node server.js          (Mac/Linux)
set PIN=112233 && node server.js   (Windows)
```

## What the phone can do

- See what's currently on screen (Live) and what's staged next (Preview).
- Step forward/back a line, jump to the first/last line.
- Send the staged line live, or blank the screen.
- Search your songs and tap one to stage it.

## Controlling it from a different network (not the same Wi-Fi)

Everything above needs the phone and computer on the same Wi-Fi. If you need
to control Presenter from somewhere else entirely — a different building,
cellular data, traveling — install **Tailscale** (free, tailscale.com) on
both the computer and the phone, signed into the same account. No changes
to these files are needed: server.js already reports every network address
the computer has, so once Tailscale is running it'll print a second address
starting with `100.` alongside the usual `192.168.x.x` one. Use that `100.x`
address on your phone instead — same PIN, same everything else, just
reachable from anywhere instead of only the same Wi-Fi.

## If the phone can't connect

- Make sure the phone and computer are on the **same Wi-Fi network** (not
  one on Wi-Fi and one on mobile data, and not a "guest" network that
  isolates devices from each other — some routers do this by default).
- Check your computer's firewall isn't blocking Node.js / port 8787.
- Double-check you typed the exact address the terminal printed — it
  changes depending on your network, so it won't be the same every time
  unless your router always assigns your computer the same IP.
- If port 8787 is already used by something else on your computer, run
  `PORT=9090 node server.js` instead (Mac/Linux) or
  `set PORT=9090 && node server.js` (Windows), then use that port number
  in both addresses above.
- The server listens on every network interface on the computer by default
  (`0.0.0.0`), so it's reachable from any device on the network it's
  connected to, not just Wi-Fi — wired Ethernet works the same way. If you'd
  rather it only ever be reachable from this same computer (no phone control
  at all), start it with `HOST=127.0.0.1 node server.js` instead.
- If the phone says the PIN is wrong, double-check the terminal — the PIN
  only changes if you deleted `.remote-pin` or set a new one with `PIN=...`.

## Notes

- Presenter still works exactly as before if you just double-click
  presenter.html and never run the server — the phone-remote code quietly
  does nothing in that case.
- The Live and Preview windows (opened from the Control window) don't need
  any changes and aren't reachable from the phone directly — only the
  Control window talks to the server.

## Installing the remote as a phone app

Open the phone link (or scan the QR code), then use the browser menu:
- **Android (Chrome):** ⋮ → *Add to Home screen*. Over a plain `http://` address Chrome makes a
  shortcut that still shows the browser bar — for a true full-screen app on Android, install the
  native app in `phone-app-android/` instead (see its README).
- **iPhone (Safari):** Share → *Add to Home Screen*

On iPhone it opens full-screen from its own icon, and the home-screen app keeps
its own storage, so it asks for the PIN once on first launch. Swipe left/right on
the Live/Staged cards for Next/Prev. The icon points at the computer's current
address, so if your router hands out a new IP, re-add it (or give the computer a
fixed IP / use the Tailscale address from the section above).

## Native Android app

`phone-app-android/` is an Android Studio project for a real installable app (address saved,
screen stays awake, volume keys = Prev/Next, QR scan opens it directly). See its README to build the APK.
