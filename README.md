# CrewPulse — a weather forecast for your body

**NASA Space Apps 2026 · team QuantSafe · challenge: health monitoring software for astronauts**

CrewPulse gives astronauts their **body weather**: today's health in one word, the next 3 days, and switches that show how a plan (like more sleep) changes the forecast. It reads a **₹3,500 chest Band** live over Bluetooth, works **fully offline**, and sends an **encrypted** daily report to ground (post-quantum protection planned).

**▶ Open / install the app:** https://shubhamsinha503.github.io/crewpulse/

**▶ See every screen with sample data (simulated, labelled):** https://shubhamsinha503.github.io/crewpulse/?sample

**▶ 30-second demo video:** https://youtu.be/XkDi06veSNg

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

## Evidence: 20 medical cases, 1970–2026
We studied 20 medical incidents and risks from real missions. CrewPulse has a signal for 13 of them; the other 7 need sensors it doesn't have yet (CO₂, toxic gas, suit, ultrasound, bone scans) or have no public cause, and no landing-readiness feature is built yet.

**Irregular-beat detector check:** run on the MIT-BIH Arrhythmia Database (PhysioNet), 44 recordings, 100,733 labelled beats: 92% precision, ranks recordings by irregular-beat load with Spearman 0.83, misses about 2 in 3 irregular beats (so the app reports change vs your own normal, never absolute counts). Reproduce: `node tools/validate-mitbih/validate.mjs`.

**Medical events**
- [Crew-11 medical evacuation](https://www.smithsonianmag.com/smart-news/nasa-to-bring-iss-crew-home-early-because-of-an-astronauts-health-issue-marking-the-first-medical-evacuation-of-the-spacecraft-180987983/)
- [Crew-11 (BGR)](https://www.bgr.com/2081171/nasa-spacex-crew-11-medical-evacuation/)
- [Crew-8 hospital stay](https://www.ksl.com/article/news/us/spacex-crew-8-astronaut-hospitalized-with-medical-issue-after-splashdown-has-been-released-nasa-says/51580566)
- [Apollo 15 bigeminy](https://en.wikipedia.org/wiki/Return_of_Apollo_15_to_Earth)
- [Laveykin](https://en.wikipedia.org/wiki/Aleksandr_Laveykin)
- [Vasyutin / Soyuz T-14](https://en.wikipedia.org/wiki/Soyuz_T-14)
- [Tsibliyev 1997](https://web.mit.edu/16.423/www/MirMishapWeb/July14%2797.html)
- [Apollo 13 Haise](https://en.wikipedia.org/wiki/Fred_Haise)
- [Apollo–Soyuz gas exposure](https://www.americaspace.com/2015/07/18/partners-in-space-the-first-u-s-russian-manned-space-mission-part-3/)
- [Parmitano EVA-23](https://www.americaspace.com/2014/02/27/a-condition-that-was-life-threatening-nasa-releases-report-into-eva-23-water-intrusion-incident/)
- [Jugular flow and clot (JAMA Netw Open 2019)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6902784/)
- [Clot treated from Earth](https://www.beckershospitalreview.com/quality/first-case-of-blood-clot-in-space-treated-from-earth/)

**Risks and rates**
- [Clinical symptoms on ISS (Crucian 2016)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5098747)
- [SANS review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10907968/)
- [Herpes virus reactivation (Rooney et al. 2019)](https://www.frontiersin.org/articles/10.3389/fmicb.2019.00016/pdf)
- [CO₂ and headaches (Law 2014)](https://ohsonline.com/articles/2014/05/12/study-indicates-co2-may-cause-astronauts-headaches.aspx)
- [Orthostatic intolerance after flight (NASA NTRS)](https://ntrs.nasa.gov/api/citations/20140008722/downloads/20140008722.pdf)
- [Atrial changes after 6 months (Khine 2018, review)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10213435)
- [NASA behavioral health risk](https://www.nasa.gov/directorates/esdmd/hhp/risk-of-adverse-cognitive-or-behavioral-conditions-and-psychiatric-disorders)

**Early warning from wearables (Earth evidence)**
- [Smartwatch pre-symptom detection (Mishra 2020)](https://med.stanford.edu/news/all-news/2020/12/smartwatch-can-detect-early-signs-of-illness.html)
- [Continuous temperature finds fever early (Smarr 2020)](https://today.ucsd.edu/story/fever_wearables_2020)

## Notes
- **Your data only.** Every number comes from your daily check-in and your Band, stored on your device. Your normal is learned from your first readings (needs 3; fully set at 14). The only simulated part is the labelled Demo Band, which is never saved.
- Radiation and cabin CO₂ are not measured yet (planned sensors).
- **Decision support only — not a medical device.**
- Fonts: IBM Plex Sans & Plex Mono (SIL Open Font License, see `astro-health/fonts/OFL.txt`).
- Built with help from AI coding tools (Claude); idea, feature choices, hardware build and testing by the team.
