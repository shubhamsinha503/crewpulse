# CrewPulse Band firmware — v0.2 (ECG + motion + skin temperature + battery → Bluetooth)

What it does now:
- Reads the **AD8232 ECG** 250 times a second.
- Finds each **heartbeat** (simplified Pan-Tompkins method) → heart rate + beat-to-beat gap.
- Sends them over **Bluetooth** as a standard heart-rate device named **"CrewPulse Band"** (+ CrewPulse status every 10 s).
- Also prints `HR,<bpm>,<rr>` lines over **USB** (backup path for the app).
- **v0.2 (31 Oct):** motion (MPU6050 on GPIO10/20) and skin temperature (DS18B20 on GPIO5) are found automatically at start-up; parts not wired yet are sent as "unknown". Battery level needs `HAS_BATTERY 1`, and the buzz test needs `HAS_BUZZ_TEST 1`. Wiring and tests: `docs/HARDWARE-PREP.md` Phases 5–6. Type **s** in the serial monitor to see which sensors were found.

---

## ✅ Status (26 Oct)
- Arduino CLI 1.5.1 + ESP32 core 3.3.12 + NimBLE-Arduino 2.5.2 installed.
- Firmware **compiles cleanly** and is **uploaded** to the μEC3 on **COM8** (the board uses the ESP32-C3's built-in USB: VID 303A / PID 1001).
- Verified on the board: boots, advertises as "CrewPulse Band", sends status every 10 s, and with nothing wired reports **leads off** (no fake beats — LO pins use pull-ups).
- **26 Oct evening: first real heartbeat ✅** — AD8232 wired (GND→G, 3.3v→3V3, OUTPUT→1, LO+→3, LO−→4), electrodes on: leads OK, signal quality 100, HR 76–94 bpm, clean QRS + T waves. Picture: `docs/media/first-real-ecg-2026-10-26.png`.
- Lessons: loose female jumpers caused on/off contact (each wire must hold firmly — solder the header); push the 3.5 mm plug fully in; laptop charger unplugged.
- Diagnostics: type **d** in the serial monitor → raw LO+/LO− states (with pull-up and pull-down) + ECG volts.
- Next: connect the app over Bluetooth.

Arduino CLI path (not on PATH in old terminals — open a new terminal, or use the full path):
`"C:\Program Files\Arduino CLI\arduino-cli.exe"`

## 1. Wiring (ECG; other sensors: docs/HARDWARE-PREP.md Phase 5–6)
| AD8232 pin | μEC3 pin | Note |
|---|---|---|
| 3.3V | 3V3 | **Not 5 V** |
| GND | GND | |
| OUTPUT | **GPIO1** | Must be GPIO 0–4 (ADC1) |
| LO+ | GPIO3 | |
| LO− | GPIO4 | |
| SDN | not connected | |

**Check the μEC3's printed labels.** If your pins differ, change the `#define` lines at the top of `crewpulse_band.ino`.

**Electrodes:** red (RA) right chest under the collarbone, yellow (LA) left chest, green (RL) lower right ribs. Clean, dry skin.

**Safety:** when electrodes touch your skin, the laptop must run on **battery** (unplug its charger), or later power the Band from its LiPo.

## 2. One-time setup (Arduino CLI)
```bash
winget install ArduinoSA.CLI
```
```bash
arduino-cli config init
```
```bash
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
```
```bash
arduino-cli core update-index
```
```bash
arduino-cli core install esp32:esp32
```
```bash
arduino-cli lib install "NimBLE-Arduino"
```
```bash
arduino-cli lib install "OneWire"
```

## 3. Upload
Plug in the μEC3, then find its COM port:
```bash
arduino-cli board list
```
Compile and upload (your board is **COM8**; run from the CrewPulse folder):
```bash
arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc firmware/crewpulse_band
```
```bash
arduino-cli upload -p COM8 --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc firmware/crewpulse_band
```
- `CDCOnBoot=cdc` makes USB printing work on boards that use the ESP32-C3's own USB port. If your board has a separate USB chip, it still works.
- Upload fails? Hold **BOOT**, tap **RESET**, release **BOOT**, try again. Use a **data** USB cable.

## 4. First test — see your heartbeat wave
```bash
arduino-cli monitor -p COM8 -c baudrate=115200
```
- You should see `# CrewPulse Band v0.2 ready` plus a `# sensors:` line and, with electrodes on, lines like `HR,68,882`.
- Type **p** + Enter → plot mode (prints the ECG wave). For a graph, open the Arduino IDE **Serial Plotter** at 115200 instead of the monitor.
- Sit still. Each beat should show a tall spike; `HR` should match your pulse (check against your wrist for 30 s).

## 5. Connect to the app
1. Close the serial monitor (only one program can use the port).
2. Open the CrewPulse app in **Chrome or Edge** → **Band** tab → **Connect Band (Bluetooth)** → pick **CrewPulse Band**.
3. Your heart rate, heartbeat strip and HRV appear. Then **Start calm reading** to set your baseline.
- Backup: **USB cable** button (uses the `HR,...` lines).

## 6. Problems
| Problem | Fix |
|---|---|
| No `HR` lines, `ST` shows flags 1 | Leads off — check electrode contact and the LO+/LO− wires |
| HR jumps around / double counts | Sit still; fresh electrodes; laptop on battery; shorter wires; check the wave in plot mode |
| HR = 0 lines missing after movement | Normal — detector re-learns for 2 s after leads-off |
| App doesn't list the Band | Bluetooth on in Windows; serial monitor shows "ready"; refresh the page |
| Compile error about NimBLE callbacks | You have NimBLE-Arduino 1.x — update to 2.x: `arduino-cli lib upgrade` |
