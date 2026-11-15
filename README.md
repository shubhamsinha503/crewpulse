# CrewPulse — a weather forecast for your body

**NASA Space Apps 2026 · team QuantSafe · challenge: health monitoring software for astronauts**

CrewPulse gives astronauts their **body weather**: today's health in one word, the next 3 days, and switches that show how a plan (like more sleep) changes the forecast. It reads a **₹3,500 chest Band** live over Bluetooth, works **fully offline**, and sends an **encrypted** daily report to ground (post-quantum protection planned).

**▶ Open / install the app:** `LIVE_LINK`

## Features
- **Body weather** — 4 conditions (fatigue, mood, heart, muscle & bone) learned from **your own** readings, today + 3-day forecast, with plain "why" lines.
- **Change your forecast** — tick a plan, watch the forecast update.
- **Go / caution check** — GO / CAUTION / NO-GO before a spacewalk, docking or routine work.
- **Crew view** — the crew medical officer's table (shows you; crewmates appear when their devices sync).
- **Live Band** — real heart rate, HRV, signal quality and a live ECG strip over Bluetooth (or USB); built-in Demo Band simulator.
- **Support** — spots signs of stress or tiredness (Band at rest, check-in, reaction time, forecast) and offers 2-minute paced breathing (6 breaths/min) with the Band's heart rate and HRV before and after, fatigue tips, and a private request to talk to the crew medical officer or ground. Signs, never a diagnosis. Based on Carter & Buckey 2005, Goessl et al. 2017, Nahum-Shani et al. 2018, Rosekind et al. 1995.
- **Early Warning Index** — four signals vs your own normal: irregular heartbeats (counted from the Band's ECG beat gaps), resting heart rate, HRV and skin temperature. Flags "more irregular beats than your normal" (Apollo 15, Mir) or "your body may be fighting something" (Apollo 13, Salyut 7), with a private flag to the crew medical officer. Prototype built on published evidence (Mishra 2020, Smarr 2020), not a diagnosis.
- **Offline + installable** — runs on board with no internet; install it like an app on Android, Windows or Mac (Chrome/Edge).
- **Encrypted report to ground** — one daily report, encrypted with AES-256-GCM in the browser, sent only when you choose. Post-quantum protection (NIST ML-KEM / ML-DSA) is planned; the Sync screen shows those steps as a labelled simulation for now.

## Install on a phone
1. Open the link above in **Chrome** (Android).
2. Tap **Install app** (or menu ⋮ → **Install app** / **Add to Home screen**).
3. Open CrewPulse from your home screen. Bluetooth Band connection works in Chrome on Android, Windows, Mac and Linux (not iPhone Safari).

## The Band (hardware)
- ESP32-C3 board + AD8232 ECG + motion, temperature, buzz motor and button; chest belt.
- Firmware: [`firmware/crewpulse_band`](firmware/crewpulse_band) — see [`firmware/README.md`](firmware/README.md) for wiring, upload and testing.

## Run locally
```
python -m http.server 5173 --directory astro-health
```
Then open http://localhost:5173.

## Notes
- **Your data only.** Every number comes from your daily check-in and your Band, stored on your device. Your normal is learned from your first readings (needs 3; fully set at 14). The only simulated part is the labelled Demo Band, which is never saved.
- Radiation and cabin CO₂ are not measured yet (planned sensors).
- **Decision support only — not a medical device.**
- Fonts: IBM Plex Sans & Plex Mono (SIL Open Font License, see `astro-health/fonts/OFL.txt`).
- Built with help from AI coding tools (Claude); idea, feature choices, hardware build and testing by the team.
