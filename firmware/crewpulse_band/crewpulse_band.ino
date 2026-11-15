/*
  CrewPulse Band — firmware v0.2 (ESP32-C3)
  Reads the AD8232 ECG, finds heartbeats, sends them to the CrewPulse app.
  v0.2: adds motion (MPU6050), skin temperature (DS18B20) and battery level.
        Motion and skin temperature are found automatically at start-up; parts not wired send "unknown".

  Sends:
   - Bluetooth: standard Heart Rate service (heart rate + beat-to-beat gaps)
                + CrewPulse service (status every 10 s, reaction test, control)
   - USB serial (115200): "HR,<bpm>,<rr ms>" and "ST,..." lines (Web Serial backup)

  Board:    "ESP32C3 Dev Module" (esp32:esp32:esp32c3)
  Library:  NimBLE-Arduino 2.x, OneWire 2.3.x
  Contract: docs/TECH-GUIDE.md section 8 (must match js/band.js)

  Serial commands (type in Serial Monitor):  p = toggle ECG plot mode,  d = diagnostics,  s = sensors,  r = start reaction test
*/
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <Wire.h>
#include <OneWire.h>

// ===================== Pins — CHECK against the μEC3 board labels =====================
#define ECG_PIN        1    // AD8232 OUTPUT  (must be an ADC1 pin: GPIO0–4)
#define LO_PLUS_PIN    3    // AD8232 LO+
#define LO_MINUS_PIN   4    // AD8232 LO-
#define MOTOR_PIN      0    // via 1 kΩ → BC547 base (only if HAS_BUZZ_TEST = 1). μEC3 has no pin 6
#define BUTTON_PIN     7    // to GND, internal pull-up (only if HAS_BUZZ_TEST = 1)
#define HAS_BUZZ_TEST  1    // set to 1 once the motor + button are wired
#define SDA_PIN       10    // MPU6050 SDA (GPIO8/9 never worked on this board: boot/LED pins)
#define SCL_PIN       20    // MPU6050 SCL (free: Serial runs over USB, not UART pins 20/21)
#define TEMP_PIN       5    // DS18B20 yellow wire, 4.7 kOhm to 3V3 (found automatically)
#define BATT_PIN       2    // battery + -> 100 kOhm -> GPIO2 -> 100 kOhm -> GND (ADC1 pin)
#define HAS_BATTERY    0    // set to 1 once the battery divider is wired (a loose ADC pin would give a fake %)

// ===================== Bluetooth IDs (must match the app) =====================
static const char* DEVICE_NAME   = "CrewPulse Band";
static const char* UUID_SERVICE  = "96540001-67d5-4fb0-a943-737a4c4c8ff5";
static const char* UUID_STATUS   = "96540002-67d5-4fb0-a943-737a4c4c8ff5";
static const char* UUID_REACTION = "96540003-67d5-4fb0-a943-737a4c4c8ff5";
static const char* UUID_CONTROL  = "96540004-67d5-4fb0-a943-737a4c4c8ff5";

NimBLECharacteristic* hrChar = nullptr;
NimBLECharacteristic* statusChar = nullptr;
NimBLECharacteristic* reactionChar = nullptr;
volatile int connectedCount = 0;
volatile bool startReactionRequested = false;
int64_t unixOffset = 0;   // unix time = millis()/1000 + unixOffset (set by the app on connect)

// ===================== ECG processing =====================
const uint32_t SAMPLE_US = 4000;          // 250 samples per second
uint32_t nextSampleUs = 0;
bool plotMode = false;
bool diagMode = false;   // 'd' = print raw LO+/LO-/ADC every 250 ms

float dcLevel = 0; bool dcReady = false;  // slow average → removes baseline drift
float maBuf[5] = {0}; int maIdx = 0; float maSum = 0;   // 5-sample average: smooths, and cancels 50 Hz mains hum
float lp1 = 0, lp2 = 0;                    // previous smoothed samples (for the slope)
const int MWI_N = 38;                      // 150 ms window
float mwiBuf[MWI_N] = {0}; int mwiIdx = 0; float mwiSum = 0;
float signalPeak = 0;                      // running estimate of a typical heartbeat peak
uint32_t learnSamples = 0;
bool inPeak = false; float peakVal = 0; uint32_t peakMs = 0;
uint32_t lastBeatMs = 0;
uint16_t rrHist[5] = {0}; int rrCount = 0;

// quality bookkeeping (per 10 s window)
uint32_t samplesWin = 0, leadsOffWin = 0, beatsWin = 0, goodRRWin = 0;
bool leadsOff = false;

void resetDetector() {
  inPeak = false; learnSamples = 0; signalPeak = 0; lastBeatMs = 0; rrCount = 0;
  for (int i = 0; i < MWI_N; i++) mwiBuf[i] = 0; mwiSum = 0;
}

uint16_t medianRR() {
  int n = rrCount < 5 ? rrCount : 5;
  uint16_t s[5];
  for (int i = 0; i < n; i++) s[i] = rrHist[i];
  for (int i = 1; i < n; i++) for (int j = i; j > 0 && s[j - 1] > s[j]; j--) { uint16_t t = s[j]; s[j] = s[j - 1]; s[j - 1] = t; }
  return n ? s[n / 2] : 0;
}

void sendHeart(uint8_t bpm, uint16_t rrMs) {
  // Standard Heart Rate Measurement: flags (RR present, 8-bit HR) · HR · RR in 1/1024 s
  uint16_t rr1024 = (uint16_t)((uint32_t)rrMs * 1024 / 1000);
  uint8_t pkt[4] = { 0x10, bpm, (uint8_t)(rr1024 & 0xFF), (uint8_t)(rr1024 >> 8) };
  if (connectedCount > 0 && hrChar) { hrChar->setValue(pkt, sizeof(pkt)); hrChar->notify(); }
  if (!plotMode) { Serial.printf("HR,%u,%u\n", bpm, rrMs); }
}

void onBeat(uint32_t tMs) {
  beatsWin++;
  if (lastBeatMs) {
    uint32_t rr = tMs - lastBeatMs;
    if (rr >= 250 && rr <= 2500) {
      uint16_t med = medianRR();
      if (!med || (rr > med * 0.8f && rr < med * 1.2f)) goodRRWin++;
      for (int i = 4; i > 0; i--) rrHist[i] = rrHist[i - 1];
      rrHist[0] = (uint16_t)rr; if (rrCount < 5) rrCount++;
      uint16_t m = medianRR();
      uint8_t bpm = (uint8_t)constrain(60000UL / (m ? m : rr), 25, 240);
      sendHeart(bpm, (uint16_t)rr);
    }
  }
  lastBeatMs = tMs;
}

// Simplified Pan-Tompkins heartbeat detector
void processSample(int raw, uint32_t tMs) {
  float x = (float)raw;
  if (!dcReady) { dcLevel = x; dcReady = true; }
  dcLevel += (x - dcLevel) * 0.02f;                  // ≈0.8 Hz high-pass
  float hp = x - dcLevel;
  maSum += hp - maBuf[maIdx]; maBuf[maIdx] = hp; maIdx = (maIdx + 1) % 5;
  float lp = maSum / 5.0f;                           // smoothing + 50 Hz cancel
  float slope = lp - lp2; lp2 = lp1; lp1 = lp;        // derivative
  float sq = slope * slope;                          // square: all peaks positive
  mwiSum += sq - mwiBuf[mwiIdx]; mwiBuf[mwiIdx] = sq; mwiIdx = (mwiIdx + 1) % MWI_N;
  float mwi = mwiSum / MWI_N;                         // 150 ms energy window

  static uint32_t plotCount = 0;
  if (plotMode && (plotCount++ & 1) == 0) Serial.printf("ecg:%.1f,energy:%.1f,threshold:%.1f\n", lp, mwi / 50.0f, 0.3f * signalPeak / 50.0f);

  if (leadsOff) return;
  if (learnSamples < 500) {                          // first 2 s: learn signal size
    if (mwi > signalPeak) signalPeak = mwi;
    learnSamples++;
    return;
  }
  float thr = 0.3f * signalPeak;
  if (!inPeak) {
    if (mwi > thr && tMs - lastBeatMs > 250) { inPeak = true; peakVal = mwi; peakMs = tMs; }
  } else {
    if (mwi > peakVal) { peakVal = mwi; peakMs = tMs; }
    if (mwi < thr * 0.5f || tMs - peakMs > 200) {
      inPeak = false;
      onBeat(peakMs);
      signalPeak = 0.875f * signalPeak + 0.125f * peakVal;
    }
  }
  if (lastBeatMs && tMs - lastBeatMs > 2500) signalPeak *= 0.998f;   // no beats → lower the bar
}

// ===================== Motion (MPU6050) =====================
// Activity = 4 x average jolt above 20 mg over the last 10 s (rest ~0, walking ~400-1000).
// The app treats > 300 as moving / exercising.
uint8_t MPU_ADDR = 0x68;
bool hasMotion = false, wireStarted = false;
uint32_t nextMotionMs = 0, motionN = 0; float motionSum = 0;
bool mpuWrite(uint8_t reg, uint8_t v) { Wire.beginTransmission(MPU_ADDR); Wire.write(reg); Wire.write(v); return Wire.endTransmission() == 0; }
void setupMotion() {
  // Fixed pins (SDA 10, SCL 20). Swapping pins at run time with Wire.end()/begin() proved unreliable on the C3
  // (stale pin routing made every address "answer"), so wiring must match. Tries both addresses (AD0 low/high).
  // 100 kHz is plenty for 25 reads a second and more forgiving of long jumper wires.
#ifdef NO_MOTION
  return;                                  // test build: motion code off
#endif
  if (!wireStarted) { Wire.begin(SDA_PIN, SCL_PIN, 100000); wireStarted = true; }
  {
    for (uint8_t a = 0x68; a <= 0x69 && !hasMotion; a++) {
      Wire.beginTransmission(a);
      if (Wire.endTransmission() != 0) continue;
      // An unpowered chip or a data line stuck low also "answers", so ask for its ID (WHO_AM_I):
      // 0x68 on a real MPU6050; clones answer 0x70 / 0x71 / 0x72 / 0x98. 0x00 or 0xFF = not really there.
      Wire.beginTransmission(a); Wire.write(0x75);
      if (Wire.endTransmission(true) != 0 || Wire.requestFrom(a, (uint8_t)1) != 1) continue;
      uint8_t who = Wire.read();
      if (who != 0x00 && who != 0xFF) { hasMotion = true; MPU_ADDR = a; }
    }
  }
  if (!hasMotion) return;
  mpuWrite(0x6B, 0x00);   // wake up
  mpuWrite(0x1C, 0x00);   // +-2 g
  mpuWrite(0x1A, 0x03);   // 44 Hz low-pass
}
uint8_t motionErr = 0;      // last I2C error code (0 = fine), shown by the 's' command
int mpuRead(uint8_t reg, uint8_t n) {       // point at a register, then read n bytes; returns bytes received
  Wire.beginTransmission(MPU_ADDR); Wire.write(reg);
  motionErr = Wire.endTransmission(true);
  if (motionErr) return 0;
  return Wire.requestFrom(MPU_ADDR, n);
}
bool readAccelG(float& ax, float& ay, float& az) {
  if (mpuRead(0x3B, 6) != 6) { if (!motionErr) motionErr = 99; return false; }
  int16_t x = (Wire.read() << 8) | Wire.read();
  int16_t y = (Wire.read() << 8) | Wire.read();
  int16_t z = (Wire.read() << 8) | Wire.read();
  ax = x / 16384.0f; ay = y / 16384.0f; az = z / 16384.0f;
  return true;
}
void runMotion() {                          // 25 times a second
  if (!hasMotion || (int32_t)(millis() - nextMotionMs) < 0) return;
  nextMotionMs = millis() + 40;
  float ax, ay, az;
  if (!readAccelG(ax, ay, az)) return;
  // Jolt = how far the total acceleration moves away from its own slow resting level (2 s average),
  // not from an exact 1 g: cheap clone sensors read 0.85-1.1 g at rest, which would look like constant movement.
  static float restG = -1;
  float mag = sqrtf(ax * ax + ay * ay + az * az);
  if (restG < 0) restG = mag;
  restG += 0.02f * (mag - restG);
  float jolt = fabsf(mag - restG) * 1000.0f;   // mg away from "still"
  motionSum += jolt > 20 ? jolt - 20 : 0; motionN++;
}

// ===================== Skin temperature (DS18B20) =====================
// One reading every 10 s: start a conversion, collect it at the next status (it needs 750 ms).
OneWire ow(TEMP_PIN);
bool hasTemp = false, tempPending = false;
float lastTempC = NAN;
void setupTemp() { hasTemp = ow.reset(); if (hasTemp) { ow.skip(); ow.write(0x44); tempPending = true; } }
void readTemp() {
  if (!hasTemp) { setupTemp(); return; }                           // probe plugged in later
  if (tempPending && ow.reset()) {
    ow.skip(); ow.write(0xBE);
    uint8_t d[9]; for (int i = 0; i < 9; i++) d[i] = ow.read();
    if (OneWire::crc8(d, 8) == d[8]) {
      float c = (int16_t)((d[1] << 8) | d[0]) / 16.0f;
      if (c > -20 && c < 60) lastTempC = c;                        // 85.0 = power-up value, skip
    } else { lastTempC = NAN; }
  }
  tempPending = false;
  if (ow.reset()) { ow.skip(); ow.write(0x44); tempPending = true; } else { hasTemp = false; lastTempC = NAN; }
}

// ===================== Battery =====================
// LiPo voltage through a 100 kOhm / 100 kOhm divider -> percent (rough curve, good enough for "charge me").
uint8_t batteryPercent(float& volts) {
  volts = NAN;
#if HAS_BATTERY
  uint32_t mv = 0; for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(BATT_PIN);
  volts = (mv / 8) * 2 / 1000.0f;
  const float V[] = { 3.30f, 3.50f, 3.60f, 3.70f, 3.80f, 3.90f, 4.00f, 4.10f, 4.20f };
  const float P[] = { 0, 6, 15, 32, 50, 65, 78, 90, 100 };
  if (volts < 2.5f) return 0xFF;                                    // nothing connected
  if (volts <= V[0]) return 0;
  for (int i = 1; i < 9; i++) if (volts <= V[i]) return (uint8_t)(P[i - 1] + (P[i] - P[i - 1]) * (volts - V[i - 1]) / (V[i] - V[i - 1]));
  return 100;
#else
  return 0xFF;
#endif
}

// ===================== Status every 10 s =====================
uint32_t lastStatusMs = 0;
void sendStatus() {
  uint8_t quality = 0;
  if (samplesWin) {
    float contact = 1.0f - (float)leadsOffWin / samplesWin;
    float rhythm = beatsWin > 1 ? (float)goodRRWin / (beatsWin - 1) : 0.0f;
    if (rhythm > 1) rhythm = 1;
    quality = (uint8_t)(100.0f * contact * (beatsWin >= 4 ? rhythm : 0.0f));
  }
  // int16 temp x100 · uint16 activity · uint8 quality · uint8 flags · uint8 battery · reserved
  // Sensors not wired -> "unknown" values (temp -32768, activity 65535, battery 255; the app shows "--")
  readTemp();
  int16_t temp = isnan(lastTempC) ? INT16_MIN : (int16_t)lroundf(lastTempC * 100);
  uint16_t activity = 0xFFFF;
  if (hasMotion && motionN) activity = (uint16_t)min(60000.0f, 4.0f * motionSum / motionN);
  motionSum = 0; motionN = 0;
  float volts; uint8_t battery = batteryPercent(volts);
  uint8_t flags = (leadsOff ? 0x01 : 0x00) | (activity != 0xFFFF && activity > 300 ? 0x02 : 0x00);
  uint8_t pkt[8] = { (uint8_t)(temp & 0xFF), (uint8_t)((uint16_t)temp >> 8), (uint8_t)(activity & 0xFF), (uint8_t)(activity >> 8), quality, flags, battery, 0 };
  if (connectedCount > 0 && statusChar) { statusChar->setValue(pkt, sizeof(pkt)); statusChar->notify(); }
  if (!plotMode) {
    char t[8] = "", a[8] = "", b[5] = "";
    if (temp != INT16_MIN) snprintf(t, sizeof(t), "%d", temp);
    if (activity != 0xFFFF) snprintf(a, sizeof(a), "%u", activity);
    if (battery != 0xFF) snprintf(b, sizeof(b), "%u", battery);
    Serial.printf("ST,%s,%s,%u,%u,%s\n", t, a, quality, flags, b);
  }
  samplesWin = leadsOffWin = beatsWin = goodRRWin = 0;
}

// ===================== Buzz reaction test (needs motor + button) =====================
#if HAS_BUZZ_TEST
struct { bool running = false; uint32_t endMs = 0, nextBuzzMs = 0, buzzStartMs = 0; bool waitingPress = false; uint16_t rts[40]; int n = 0; uint8_t lapses = 0, falseStarts = 0; bool lastBtn = true; uint32_t lastEdgeMs = 0; } rt;

void startReaction() {
  rt.running = true; rt.n = 0; rt.lapses = 0; rt.falseStarts = 0; rt.waitingPress = false;
  rt.endMs = millis() + 60000; rt.nextBuzzMs = millis() + random(2000, 5000);
}
void finishReaction() {
  rt.running = false; digitalWrite(MOTOR_PIN, LOW);
  for (int i = 1; i < rt.n; i++) for (int j = i; j > 0 && rt.rts[j - 1] > rt.rts[j]; j--) { uint16_t t = rt.rts[j]; rt.rts[j] = rt.rts[j - 1]; rt.rts[j - 1] = t; }
  uint16_t med = rt.n ? rt.rts[rt.n / 2] : 0;
  uint8_t pkt[4] = { (uint8_t)(med & 0xFF), (uint8_t)(med >> 8), rt.lapses, rt.falseStarts };
  if (connectedCount > 0 && reactionChar) { reactionChar->setValue(pkt, sizeof(pkt)); reactionChar->notify(); }
  Serial.printf("RT,%u,%u,%u\n", med, rt.lapses, rt.falseStarts);
}
void runReaction() {
  if (!rt.running) return;
  uint32_t now = millis();
  bool btn = digitalRead(BUTTON_PIN);                // LOW = pressed
  bool pressed = (!btn && rt.lastBtn && now - rt.lastEdgeMs > 30);
  if (btn != rt.lastBtn) { rt.lastEdgeMs = now; rt.lastBtn = btn; }
  if (now - rt.buzzStartMs > 150) digitalWrite(MOTOR_PIN, LOW);
  if (rt.waitingPress) {
    if (pressed) { uint16_t ms = now - rt.buzzStartMs; if (rt.n < 40) rt.rts[rt.n++] = ms; if (ms > 500) rt.lapses++; rt.waitingPress = false; rt.nextBuzzMs = now + random(2000, 5000); }
    else if (now - rt.buzzStartMs > 2000) { rt.lapses++; rt.waitingPress = false; rt.nextBuzzMs = now + random(2000, 5000); }
  } else {
    if (pressed) rt.falseStarts++;
    if (now >= rt.nextBuzzMs) { digitalWrite(MOTOR_PIN, HIGH); rt.buzzStartMs = now; rt.waitingPress = true; }
  }
  if (now > rt.endMs && !rt.waitingPress) finishReaction();
}
#endif

// ===================== Bluetooth callbacks =====================
class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override { connectedCount++; Serial.println("# app connected"); }
  void onDisconnect(NimBLEServer* s, NimBLEConnInfo& info, int reason) override {
    if (connectedCount > 0) connectedCount--;
    Serial.println("# app disconnected");
    NimBLEDevice::startAdvertising();
  }
};
class ControlCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& info) override {
    NimBLEAttValue v = c->getValue();
    if (v.length() < 1) return;
    const uint8_t* d = v.data();
    switch (d[0]) {
      case 0x01: startReactionRequested = true; break;            // start reaction test
      case 0x05:                                                    // set clock
        if (v.length() >= 5) { uint32_t unix = d[1] | (d[2] << 8) | (d[3] << 16) | ((uint32_t)d[4] << 24); unixOffset = (int64_t)unix - (int64_t)(millis() / 1000); }
        break;
      default: break;                                               // 02/03/04: later versions
    }
  }
};

void setupBluetooth() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCB());

  NimBLEService* hrs = server->createService("180D");
  hrChar = hrs->createCharacteristic("2A37", NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* loc = hrs->createCharacteristic("2A38", NIMBLE_PROPERTY::READ);
  uint8_t chest = 1; loc->setValue(&chest, 1);                       // body sensor location: chest
  hrs->start();

  NimBLEService* cp = server->createService(UUID_SERVICE);
  statusChar = cp->createCharacteristic(UUID_STATUS, NIMBLE_PROPERTY::NOTIFY);
  reactionChar = cp->createCharacteristic(UUID_REACTION, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* control = cp->createCharacteristic(UUID_CONTROL, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  control->setCallbacks(new ControlCB());
  cp->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setName(DEVICE_NAME);
  adv->addServiceUUID("180D");      // small 16-bit ID keeps the name inside the advert
  adv->start();
}

void printSensors() {
  float v; uint8_t b = batteryPercent(v);
  if (!hasMotion) setupMotion();                     // try again, in case it was plugged in after start-up
  if (!hasMotion) {
    // Wiring check for SDA (10) / SCL (20): the sensor board's own 4.7-10k pull-ups beat our weak pull-down,
    // so "HIGH" = sensor powered and wire connected; "LOW" = wire loose, sensor unpowered, or on G.
    // Then drive each line LOW: if it stays HIGH, the wire is touching 3V3.
    Wire.end(); wireStarted = false;
    const uint8_t lp[2] = { SDA_PIN, SCL_PIN }; const char* ln[2] = { "SDA", "SCL" };
    Serial.print("# motion wires:");
    for (int i = 0; i < 2; i++) {
      pinMode(lp[i], INPUT_PULLDOWN); delay(2);
      int up = digitalRead(lp[i]);
      pinMode(lp[i], OUTPUT_OPEN_DRAIN); digitalWrite(lp[i], LOW); delayMicroseconds(50);
      int stuck = digitalRead(lp[i]);
      digitalWrite(lp[i], HIGH); pinMode(lp[i], INPUT);
      Serial.printf(" %s(pin %d) %s", ln[i], lp[i], stuck ? "STUCK at 3V3" : up ? "HIGH (OK)" : "LOW: loose/unpowered");
    }
    Serial.println();
    setupMotion();                                   // restarts the bus on the same pins
    if (!hasMotion) {                                // list anything that answers (MPU6050 should be 0x68 or 0x69)
      Serial.print("# I2C scan (SDA 10, SCL 20):");
      int n = 0;
      for (uint8_t a = 1; a < 127; a++) { Wire.beginTransmission(a); if (Wire.endTransmission() == 0) { Serial.printf(" 0x%02X", a); n++; } }
      Serial.println(n ? "" : " nothing answered");
    }
  }
  Serial.printf("# sensors: motion %s, skin temp %s", hasMotion ? "OK" : "not found (check SDA->10, SCL->20, VCC, GND)", hasTemp ? "OK" : "not found");
  if (!isnan(lastTempC)) Serial.printf(" (%.2f C)", lastTempC);
  // Wiring check: with 3V3 + the 4.7k resistor in place, the idle data line sits HIGH.
  // LOW = no 3V3 at the resistor, or the data wire touches G. HIGH but no probe = check probe GND / data joint.
  if (!hasTemp) {
    // Weak internal pull-down (~45k): only a connected 4.7k pull-up to 3V3 can hold the line HIGH,
    // so a floating pin (resistor loose) can't fool the check.
    pinMode(TEMP_PIN, INPUT_PULLDOWN); delay(2);
    int lvl = digitalRead(TEMP_PIN);
    // Can the pin pull the line LOW? (the probe only answers if it can) Stuck HIGH = line wired straight to 3V3.
    pinMode(TEMP_PIN, OUTPUT_OPEN_DRAIN); digitalWrite(TEMP_PIN, LOW); delayMicroseconds(50);
    int pulled = digitalRead(TEMP_PIN);
    digitalWrite(TEMP_PIN, HIGH);
    pinMode(TEMP_PIN, INPUT);
    Serial.printf(" [data pin %d %s; drive-low test %s]", TEMP_PIN,
                  lvl ? "pulled HIGH: resistor + 3V3 OK, so check probe GND / probe wires"
                      : "LOW: resistor loose, no 3V3 at resistor, or data touches G",
                  pulled ? "FAILED - line stuck at 3V3: data wire is on a 3V3 point" : "OK");
  }
  if (b != 0xFF) Serial.printf(", battery %u%% (%.2f V)", b, v); else Serial.print(", battery not set up");
  if (hasMotion) {
    uint8_t who = mpuRead(0x75, 1) == 1 ? Wire.read() : 0;     // WHO_AM_I: 0x68 on a real MPU6050
    float ax, ay, az;
    if (readAccelG(ax, ay, az)) Serial.printf(", accel %.2f %.2f %.2f g (id 0x%02X)", ax, ay, az, who);
    else Serial.printf(", motion read failed (id 0x%02X, err %u)", who, motionErr);
  }
  Serial.println(HAS_BUZZ_TEST ? ", buzz test ON" : ", buzz test off");
}

// ===================== Main =====================
void setup() {
  Serial.begin(115200);
  delay(300);
  // Pull-ups: if the AD8232 is missing or a wire is loose, these read HIGH = "leads off",
  // so floating-pin noise can never be sent as fake heartbeats. The AD8232 drives them when connected.
  pinMode(LO_PLUS_PIN, INPUT_PULLUP);
  pinMode(LO_MINUS_PIN, INPUT_PULLUP);
  analogReadResolution(12);
#if HAS_BUZZ_TEST
  pinMode(MOTOR_PIN, OUTPUT); digitalWrite(MOTOR_PIN, LOW);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  randomSeed(analogRead(ECG_PIN) ^ micros());
#endif
  setupMotion();
  setupTemp();
  setupBluetooth();
  Serial.println("# CrewPulse Band v0.2 ready - advertising as 'CrewPulse Band'");
  printSensors();
  nextSampleUs = micros();
}

void loop() {
  // 1) ECG at 250 Hz (catch up if the loop was briefly busy)
  int guard = 0;
  while ((int32_t)(micros() - nextSampleUs) >= 0 && guard++ < 10) {
    nextSampleUs += SAMPLE_US;
    bool off = digitalRead(LO_PLUS_PIN) || digitalRead(LO_MINUS_PIN);
    if (off && !leadsOff) resetDetector();
    leadsOff = off;
    samplesWin++; if (off) leadsOffWin++;
    processSample(analogRead(ECG_PIN), millis());
  }
  // diagnostics: raw pin states + ECG voltage
  static uint32_t lastDiag = 0;
  if (diagMode && millis() - lastDiag >= 250) {
    lastDiag = millis();
    int raw = analogRead(ECG_PIN);
    // Same pins with pull-DOWN: if they now read 0, nothing is driving them (AD8232 unpowered / not connected)
    pinMode(LO_PLUS_PIN, INPUT_PULLDOWN); pinMode(LO_MINUS_PIN, INPUT_PULLDOWN); delayMicroseconds(200);
    int pdP = digitalRead(LO_PLUS_PIN), pdM = digitalRead(LO_MINUS_PIN);
    pinMode(LO_PLUS_PIN, INPUT_PULLUP); pinMode(LO_MINUS_PIN, INPUT_PULLUP);
    Serial.print("DRV,LO+pulldown="); Serial.print(pdP); Serial.print(",LO-pulldown="); Serial.println(pdM);
    Serial.printf("DBG,LO+=%d,LO-=%d,ecgRaw=%d,ecgVolts=%.2f\n", digitalRead(LO_PLUS_PIN), digitalRead(LO_MINUS_PIN), raw, raw * 3.3f / 4095.0f);
  }
  runMotion();
  // 2) status every 10 s
  if (millis() - lastStatusMs >= 10000) { lastStatusMs = millis(); sendStatus(); }
  // 3) commands
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == 'p' || ch == 'P') plotMode = !plotMode;
    if (ch == 'd' || ch == 'D') diagMode = !diagMode;
    if (ch == 'r' || ch == 'R') startReactionRequested = true;
    if (ch == 's' || ch == 'S') printSensors();
  }
#if HAS_BUZZ_TEST
  if (startReactionRequested) { startReactionRequested = false; startReaction(); }
  runReaction();
#else
  if (startReactionRequested) { startReactionRequested = false; Serial.println("# buzz test not wired yet (HAS_BUZZ_TEST = 0)"); }
#endif
}
