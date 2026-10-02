# Azimuth

An Android app for the **RTL-SDR Blog V4** (and other RTL2832U dongles) that does two things well:

- **Radio:** a live spectrum analyzer and wideband FM receiver.
- **Satellites:** predicts the next **Meteor-M2 3 / M2-4** weather-satellite passes over your location, shows each pass N2YO-style (ground track on a map plus a sky plot), and **records the pass** to a file you can turn into a weather image with SatDump.

Everything is computed on the phone. There are no accounts and no servers of ours; orbital data comes from CelesTrak and SatNOGS.

## Status

Built and verified without hardware in the loop: the full app compiles for Android (debug APK builds), the JavaScript bundles with Hermes, 70+ unit tests and 450 native DSP checks pass, and the pass predictor matches an independent implementation (Skyfield) to under a second on all 12 passes in a 48 hour comparison.

**Not yet verified on a real satellite pass.** FM reception, the spectrum and the USB driver were confirmed on a real V4. Satellite capture needs a real overhead pass and a suitable antenna. See [Known limitations](#known-limitations).

## Screens

| Tab | What it does |
|-----|--------------|
| **Radio** | Connect the dongle, tune any frequency 0.5 MHz to 1.766 GHz (HF via the V4 upconverter), live spectrum, mono wideband-FM audio with volume. |
| **Satellites** | Next passes for M2-3 and M2-4 (peak elevation, direction, quality, countdown), reminders, and per-pass detail: ground-track map with coverage footprint, polar sky plot, a time scrubber, and a **Capture** button. |
| **Recordings** | Saved passes with size, duration, peak elevation and gap count. Share, export to Downloads, or delete. |
| **Settings** | Location (GPS or manual), minimum pass elevation, reminders, orbital-data status, storage. |

## Hardware

- Android 7+ phone with USB host (OTG), plus an OTG adapter
- RTL-SDR Blog V4 (RTL2832U + R828D). Other RTL2832U dongles should work for Radio.
- For satellites: a **137 MHz antenna** with a clear view of the sky, outdoors if you can. A V-dipole (two 53 cm elements at 120 degrees, pointing at the sky) is the usual starter; a QFH is better. The short telescopic FM whip is not suitable. An LNA powered through the V4 **bias-tee** helps on weak passes (the toggle is on the capture screen).

## Setup and run

Requirements: Node 20+, JDK 17 or 21, Android SDK with an NDK (r26/r27) and CMake 3.22.1, `ANDROID_HOME` set.

```bash
npm install
npx expo run:android      # builds and installs a development build
npm start                 # later: just start Metro
```

This needs a **development build**, not Expo Go (it contains a local native module).

The dongle uses the phone's only USB port, so you cannot also have `adb` over USB. Use wireless debugging (Settings > Developer options > Wireless debugging), then `adb connect <ip>:<port>` and `adb reverse tcp:8081 tcp:8081` so the app can reach Metro. Alternatively install a release build, which bundles its JavaScript:

```bash
npx expo run:android --variant release
```

Logs: `adb logcat -s RtlSdrJni librtlsdr RtlSdrModule`.

## Recording a pass

1. Open **Satellites**, tap a pass, and check the sky plot and quality. Passes above about 30 degrees decode best.
2. The **Capture** button becomes available 5 minutes before the pass. Open it.
3. Choose the downlink frequency (137.100 or 137.900 MHz; see below), gain (auto is a fine start) and bias-tee.
4. Optional but recommended: **Monitor signal first** to confirm the antenna works and see which frequency the satellite is on.
5. Tap **Start recording**. It runs as an Android foreground service, so it continues with the screen off, and it stops itself shortly after the satellite sets. You can stop earlier; the part recorded is saved.

Manual capture only for now: nothing starts by itself.

### Which frequency?

SatNOGS lists both 137.100 and 137.900 MHz for each of M2-3 and M2-4, and operators switch between them, so the app does not guess. Use the signal monitor: LRPT shows up as a flat-topped block about 140 kHz wide at one of the two marked frequencies. The choice is remembered per satellite.

## What is stored

Each pass becomes a folder in the app's storage (`Android/data/<package>/files/captures/`):

```
Meteor-M2-4_20261002T191930Z/
├── baseband.cs8            raw signal samples, no header
└── baseband.sigmf-meta     metadata (SigMF 1.0.0 JSON)
```

- **`baseband.cs8`**: interleaved signed 8-bit I/Q at **288 kS/s** centred on the downlink frequency (SigMF datatype `ci8`). The dongle runs at 2.304 MS/s; the app low-pass filters and decimates by 8 on the fly, with a slow automatic gain so the weak signal is not lost in 8-bit rounding. About **0.58 MB per second, roughly 350 MB for a 10 minute pass.**
- **`baseband.sigmf-meta`**: satellite, NORAD ID, frequency, sample rate, gain, bias-tee, receiver, pass times and peak elevation, the orbital elements used, your location rounded to about 1 km, and at the end the byte count, duration and number of lost USB blocks (**0 means a gap-free capture**). It is written when recording starts and finalised when it stops, so a crash still leaves a usable file.

**Share** sends the data file through Android's share sheet. **Export** copies the whole folder to `Downloads/Azimuth/<name>/` so a computer can reach it.

## From recording to image

The app records; it does not yet decode. Use [SatDump](https://www.satdump.org/) on a computer:

1. Export or share `baseband.cs8` to the computer.
2. In SatDump choose **Offline processing**, pipeline **METEOR M2-X LRPT 72k** (`meteor_m2-x_lrpt`), or the **80k** variant (`meteor_m2-x_lrpt_80k`) if no frames are found.
3. Input level: **Baseband**. Baseband format: **cs8**. Sample rate: **288000**. Select the file and start.
4. The channel images and composites appear in the output folder.

An in-app decoder (QPSK demodulation, Viterbi, Reed-Solomon, image assembly) is the planned next phase; the recording format above is exactly what it will read.

## Pass prediction

Orbital elements come from CelesTrak (by NORAD ID) with SatNOGS DB as a fallback, are cached on the phone, and refresh every 12 hours. SGP4 propagation uses `satellite.js`. Rise, set and peak times are refined to about one second. The app warns when the cached data is older than 5 days.

Meteor-M2 4 (NORAD 59051) and Meteor-M2 3 (NORAD 57166) are tracked. To add another satellite, add an entry to `src/data/satellites.ts`.

## Project structure

```
App.tsx, index.ts, metro.config.js
src/
  theme/            design tokens (colors, Space Grotesk typography)
  components/       GlassCard, Screen, buttons/badges, SpectrumVisualizer, starfield
  navigation/       bottom tabs + Satellites stack (Passes > Detail > Capture)
  screens/
    radio/          Radio tab
    satellites/     passes list, pass detail, capture, ground-track map, sky plot
    recordings/     recordings library
    settings/       settings
  data/
    tle/            TLE fetch (CelesTrak + SatNOGS), parse, cache
    propagation/    SGP4 wrapper and pass prediction
    satellites.ts   the satellites the app knows
  receiver/         shared dongle state (connect, tune, modes)
  capture/          recording orchestration and SigMF metadata
  state/            persisted settings, location, passes (Zustand + MMKV)
  notifications/    pass reminders
  utils/            formatting, signal estimate
modules/rtl-sdr/
  index.ts, src/    TypeScript API
  android/
    src/main/java/  Kotlin: USB, streaming, recording, foreground service
    src/main/cpp/   C++: JNI bridge, FFT, FM demodulator, baseband recorder,
                    and vendored librtlsdr (RTL-SDR Blog fork) + libusb
```

## Development

```bash
npm test                                   # TypeScript tests (Jest)
npm run typecheck
sh modules/rtl-sdr/android/src/main/cpp/tests/run.sh   # native DSP checks, host-only
npx expo prebuild --platform android       # then: cd android && ./gradlew :rtl-sdr:assembleDebug
```

The native DSP test builds with any C++17 compiler and checks the spectrum placement, FM demodulation accuracy, stereo-pilot rejection, recorder file sizes, filter alias rejection and gain control.

## Known limitations

- **No real-pass verification yet.** The capture path (decimation, file format, foreground service, storage) is tested synthetically and builds, but has not recorded a real LRPT signal.
- **Sharing a recording** uses `expo-sharing` on app-private storage, which some devices refuse. **Export to Downloads** (Android 10+) is the reliable route.
- **Scheduled/automatic capture** is not implemented; you start each recording yourself.
- **Android only.** No iOS or web support (the web build has stubs that throw).
- **Display scaling** (bar height) uses a fixed dB range chosen from calculation; adjust `DISPLAY_FLOOR_DB` / `DISPLAY_CEIL_DB` in `RtlSdrModule.kt` if your noise floor sits high or low.
- Gain is automatic or a fixed step; PPM correction is not exposed.

## Data sources

[CelesTrak](https://celestrak.org/) and [SatNOGS DB](https://db.satnogs.org/) for orbital elements. The map uses the bundled equirectangular Earth image `assets/earth-day.jpg`, so it works offline.

## License

Azimuth is licensed **GPL-3.0-or-later** (see `LICENSE`). It statically links the RTL-SDR Blog fork of `librtlsdr` (GPL-2.0-or-later) and libusb 1.0.27 (LGPL-2.1-or-later), so distributing a built app requires making the app's source available under a GPL-compatible license. Provenance, versions and the one local patch (`rtlsdr_open_fd`, which wraps Android's USB file descriptor) are in `modules/rtl-sdr/android/src/main/cpp/third_party/README.md`.
