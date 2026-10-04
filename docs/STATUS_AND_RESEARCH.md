# Azimuth: project status and satellite research

Last updated: 2 October 2026.

This document records what has been built so far, what has and has not been verified, and the research behind the
design decisions (Meteor-M2 3 / M2-4 reception, RTL-SDR practice, and the data sources used). It is meant to be read
by someone picking the project up cold.

---

## 1. What Azimuth is

An Android app (Expo SDK 57, React Native 0.86, TypeScript, plus a local native module in Kotlin and C++) for the
**RTL-SDR Blog V4** dongle. It does two jobs:

1. **Radio:** live spectrum analyzer and mono wideband-FM receiver.
2. **Satellites:** predicts passes of **Meteor-M2 3** and **Meteor-M2 4** over the phone's location, shows each pass
   (ground track on a map, polar sky plot), and **records the pass** to a file that SatDump can decode into weather
   images.

Everything is computed on the phone. Orbital data comes from CelesTrak and SatNOGS. There are no accounts and no
servers of ours.

User context: RTL-SDR Blog V4 on an Android phone over USB-OTG, based in Washington, DC (so FM de-emphasis is
75 microseconds).

---

## 2. What is built

### 2.1 App screens

| Tab | Contents |
|---|---|
| **Radio** | Connect/disconnect the dongle; live spectrum (one SVG path per frame); tune 0.5 MHz to 1.766 GHz with typed entry, ±0.1/±1 MHz steps and presets; mono wideband-FM audio with volume; stream start/stop with progress states and timeouts. |
| **Satellites** | Next-pass hero card with countdown and a **Capture** button (locked until 5 minutes before the pass); grouped pass list with quality, direction and reminders. Pass detail: ground-track map over a bundled Earth image with the coverage footprint, polar sky plot, time scrubber, timeline, read-only downlink info. |
| **Capture** (from a pass) | Redesigned screen: primary button at the top (Connect receiver / Start recording / Stop recording / Done), receiver status card, automatic set-up checklist, live signal card, recording statistics, result card, tips card. No manual frequency, gain or bias-tee controls. |
| **Recordings** | Saved passes with size, duration, peak elevation, gap count, format badge; Share, Export to Downloads, Delete. |
| **Settings** | Location (GPS or manual), minimum pass elevation, reminders, **recording format**, **antenna power (bias-tee)**, orbital-data status, storage, testing mode. |

### 2.2 Native module (`modules/rtl-sdr`)

- **Driver:** the RTL-SDR Blog fork of `librtlsdr` (V4 / R828D HF-upconverter aware) and libusb 1.0.27, built with
  the NDK through CMake. One local patch: `rtlsdr_open_fd()` wraps the file descriptor Android's `UsbManager` grants,
  because Android's sandbox blocks libusb from enumerating the bus.
- **Streaming:** `rtlsdr_read_async` with 16 queued 64,000-byte USB transfers and a 24-block queue, so processing time
  never causes the dongle to drop samples. Stopping the reader is bounded (3 s deadline) because the driver's
  `rtlsdr_close()` would otherwise wait forever on a stuck reader.
- **DSP (C++):**
  - 1024-point FFT with Hann window, averaged, DC spike suppressed, grouped into 64 display bins.
  - Mono wideband-FM demodulator: low-pass and /10, quadrature discriminator, 16 kHz low-pass and /5, 75 µs
    de-emphasis, 48 kHz PCM.
  - Baseband recorder with two modes (see 2.4).
  - Per-block ADC statistics (RMS level and fraction of samples on the converter's rails) used by the auto-gain.
- **Kotlin:** USB discovery and permission, the stream thread, Android `AudioTrack` playback (non-blocking writes so
  audio can never stall USB reads), recording lifecycle with a native hard time limit, a **foreground service** so a
  recording survives the screen turning off, storage listing, export to Downloads through MediaStore.
- **Controls exposed to JS:** connect, tune, start/stop stream, sample rate (2.4 MS/s or 2.304 MS/s), manual gain,
  gain list, bias-tee, audio, recording, recording management.

### 2.3 Pass prediction

- SGP4 via `satellite.js`; passes found by sampling every 30 s and then refining rise, set and peak to about
  1 second. A pass already in progress is included with its true rise time.
- Ground track, sky track (azimuth/elevation), coverage footprint (about 28° radius at Meteor altitude), antimeridian-safe.
- Orbital elements: CelesTrak by NORAD ID, with SatNOGS DB as a fallback, cached (refreshed every 12 hours, warns
  after 5 days).

### 2.4 Recording

Output per pass: a folder containing `baseband.cs8` and `baseband.sigmf-meta` (SigMF 1.0.0). The data is
interleaved **signed 8-bit I/Q** (SigMF `ci8`, SatDump `cs8`), centred on the downlink the app chose.

| | **Full band** (default) | **Compact** |
|---|---|---|
| Purpose | Match how SatDump records | Small files |
| Sample rate | 2.304 MS/s | 288 kS/s |
| Spectrum covered | about 2.3 MHz (both Meteor downlinks inside) | about 0.29 MHz |
| Processing | None. Byte-for-byte copy of the dongle's stream; unsigned converted to signed | Low-pass, /8 decimation, DC removal, slow level adjustment |
| Size | about 4.6 MB/s, roughly 2.8 GB per 10 minutes | about 0.58 MB/s, roughly 350 MB per 10 minutes |

Metadata includes satellite, NORAD ID, frequency, sample rate, format, spectrum range covered, gain and why it was
chosen, any gain steps during the pass, bias-tee, receiver, pass times and peak elevation, the orbital elements used,
observer location rounded to about 1 km, and at the end the byte count, duration and **number of lost USB blocks**
(0 means a gap-free capture). It is written when recording starts and finalised at the end, so a crash still leaves
a usable file.

Before starting, the app checks free storage for the chosen format and refuses if there is not enough.

### 2.5 Automatic capture set-up

Frequency and gain are chosen by the app, not the user:

1. **Frequency.** The receiver is tuned halfway between 137.1 and 137.9 MHz so both downlinks are in the 2.3 MHz view;
   an LRPT-shaped block is looked for on each. If one shows it, that frequency is used; otherwise the frequency
   SatNOGS observations say works; otherwise 137.900 MHz. The monitor keeps watching and follows the signal if it
   moves.
2. **Gain.** About eight **manual** gains between 20 and 44 dB are swept, measuring raw level, clipping and the
   signal at each. The best signal wins if one is visible; otherwise the lowest gain at which the 8-bit converter's
   rounding noise is negligible (RMS at least 0.09 of full scale) with headroom (at most 0.25) and no clipping. When
   a real signal appears later, the gain is refined once on it. The tuner's own AGC is never used.
3. **During recording** the gain is only ever lowered, one step, if clipping persists above 0.5% for 1.5 s. Changes
   are logged in the metadata.
4. **Antenna power (bias-tee)** is deliberately *not* automatic (see 4.4). It is a one-time Settings choice, off by
   default, with a confirmation prompt.

### 2.6 Signal meter

Decides whether the centre of the spectrum looks like LRPT (a flat-topped block about 140 kHz wide with a clear drop
either side). It compares the block with the noise immediately beside it on both sides (so the receiver's passband
tilt cancels), uses the second-lowest of four centre bins (so a one- or two-bin spike cannot fake a signal), and
checks the shoulders. Verdicts: none, narrow carrier, broad signal, LRPT-like (weak/good/strong). It is an indicator
for lining things up, not a calibrated measurement, and cannot recognise a hump wider than about 300 kHz.

### 2.7 Project layout

```
App.tsx, index.ts, metro.config.js, app.json
src/
  theme/            colors and Space Grotesk typography
  components/       GlassCard, Screen, ui (buttons, chips, badges), SpectrumVisualizer, LiveSpectrum, starfield
  navigation/       bottom tabs and the Satellites stack (Passes > Detail > Capture)
  screens/          radio/, satellites/ (+ components/, capture/), recordings/, settings/
  data/             satellites.ts, transmitters.ts (SatNOGS), tle/ (fetch, parse, cache), propagation/ (SGP4, passes)
  receiver/         shared receiver state, frame collector
  capture/          useCapture (orchestration), autoSetup (+ store), autoGain, sigmf, window, setupInput
  state/            settings, location, passes (Zustand + MMKV), frequency, pass ids
  notifications/    pass reminders
  utils/            format, signal analysis, frame gate, async helpers, spectrum path
modules/rtl-sdr/
  index.ts, src/    TypeScript API
  android/src/main/java/   Kotlin: USB, streaming, recording, foreground service
  android/src/main/cpp/    JNI, FFT, FM demodulator, recorder, tests/, third_party/ (librtlsdr, libusb)
docs/               this file
README.md           setup and usage
```

### 2.8 Licensing

The app is GPL-3.0-or-later. It statically links the RTL-SDR Blog `librtlsdr` fork (GPL-2.0-or-later) and libusb
(LGPL-2.1-or-later), so distributing a built app requires publishing its source under a GPL-compatible licence.
Provenance and the one patch are documented in `modules/rtl-sdr/android/src/main/cpp/third_party/README.md`.

---

## 3. Verification status

**Verified without a satellite or a real pass:**

- The whole app compiles for Android (a debug APK builds; the native module builds for arm64, armeabi-v7a and
  x86_64), and the JavaScript bundles with Hermes.
- `tsc` is clean. **188 TypeScript tests** pass in 23 suites, and **475 host-side native DSP checks** pass
  (`modules/rtl-sdr/android/src/main/cpp/tests/run.sh`).
- **Pass predictions** match an independent SGP4 implementation (Skyfield): 12 of 12 passes over 48 hours, rise, peak
  and set within 0.85 s, peak elevation within 0.003°.
- Live data sources were exercised against the real servers: CelesTrak and SatNOGS TLEs for both satellites, and
  SatNOGS observations for the frequency choice.
- The recorder's full-band mode is a verified byte-for-byte copy of its input (only unsigned to signed), and keeps a
  tone 800 kHz off-centre; compact mode preserves in-band tones and rejects aliases by more than 60 dB.
- FM demodulation accuracy and stereo-pilot rejection (63 dB) against synthetic signals.
- The auto-set-up logic runs against simulated radios (quiet room, strong interference, signal on either frequency,
  cancellation, no data).
- The Start-recording flow runs end to end against a mocked radio (settings applied, metadata written, clipping guard,
  storage check, clean-up), and the Capture screen renders correctly in every state.
- On real hardware (the user's V4): USB permission and open, V4/R828D detection, tuning, spectrum, FM reception and
  audio worked once the issues found along the way were fixed (see section 5).

**Not yet verified:**

- **A real LRPT pass.** No satellite image has been decoded from an Azimuth recording yet.
- The auto-gain thresholds on real antennas (they are reasoned from published guidance, not tuned on hardware).
- A full 10-minute screen-off, full-band (4.6 MB/s) recording on the phone, including OEM battery-saver behaviour
  and sustained write speed.
- SatDump actually decoding an Azimuth `baseband.cs8` (the format is the documented one, but this has not been run).
- Android's share sheet for app-private files on every device (Export to Downloads is the reliable route).

**Suggested validation:** record one high pass (peak above 30°) with the app and, if possible, the same pass with
SatDump on a laptop on the same antenna. Compare gap count (should be none), SatDump's decoder SNR on each file, and
the resulting images.

---

## 4. Research

### 4.1 The satellites

| | Meteor-M2 3 | Meteor-M2 4 |
|---|---|---|
| NORAD ID | 57166 | 59051 |
| Launched | 27 June 2023 (Soyuz-2) | 29 February 2024 |
| Status (SatNOGS, Oct 2026) | in orbit | in orbit |
| Orbit | sun-synchronous, about 830 km, inclination about 98.6° | sun-synchronous, about 830 km, inclination about 98.7° |
| Revolutions per day | about 14.24 | about 14.22 |

- Both transmit **LRPT** (Low Rate Picture Transmission), digital QPSK, in the 137 MHz band: **72 kbps** (also an
  **80 kbps** variant) at **137.100 MHz** and **137.900 MHz**, plus an 80k entry at 137.9125 MHz. The signal is about
  115 to 150 kHz wide.
- Passes last roughly 8 to 16 minutes. The coverage circle (visible when the satellite is above the horizon at 0°
  elevation) has a radius of about 28° of arc.
- **Meteor-M2 3 has an antenna problem.** The LRPT antenna may not have deployed fully, which explains reports of
  poor reception at some elevations. A V-dipole, whose orientation can be adjusted, is better than a QFH for M2-3;
  a QFH is forgiving for M2-4.
- Other 137 MHz weather sources that can appear near the band (and are not Meteor): NOAA APT at 137.100 (NOAA 19),
  137.620 (NOAA 15) and 137.9125 MHz (NOAA 18); ORBCOMM satellites also transmit around 137.2 to 137.8 MHz.

### 4.2 Which frequency is in use (SatNOGS evidence)

SatNOGS DB lists **both 137.100 and 137.900 MHz** for each satellite, so the transmitter list alone cannot say which
is active. SatNOGS *observations* can:

- For both satellites, **every recent vetted-"good" LRPT-band observation was at 137.900 MHz** (25 of 25 each in the
  latest page; 1 additionally in "LRPT 72 kbps" mode with certainty 100 for M2-4).
- Nobody schedules observations at 137.100 MHz, so it is *untested*, not proven unused.
- SatDump's own guidance and a worked M2-4 example agree: **137.900 MHz primary, 137.100 MHz backup**.

Hence the design: use SatNOGS evidence as the starting guess, then confirm with the live signal on both frequencies.

### 4.3 Receiving LRPT with an RTL-SDR: best practice

Collected from published guides ([RTL-SDR.com tutorial](https://www.rtl-sdr.com/rtl-sdr-tutorial-receiving-meteor-m-n2-lrpt-weather-satellite-images-rtl-sdr/),
[SDRstore SatDump guide](https://www.sdrstore.eu/satdump-v2-rtl-sdr-complete-beginner-setup-guide/),
[Meteor M2-4 reception notes](https://gdamdam.github.io/meteor-satellite-reception/meteor-m2-4-2026-09-23.html),
[VU3DXR guide](https://vu3dxr.in/how-to-receive-stunning-weather-images-from-meteor-m2-satellites/)):

- **Gain:** do **not** use RTL AGC or the tuner AGC; they distort the narrow LRPT signal. Use manual gain, moderate:
  start around 25 to 30 dB (about 25 with an LNA), and never set maximum, since too much gain raises the noise floor
  and reduces decoding quality. Reduce it if the waterfall is very bright and noisy or the signal clips.
- **Sample rate:** about 1.024 or 2.048 MS/s (2.4 MS/s is the practical RTL maximum). **Never use 250 kS/s**; that mode
  has bugs and badly degrades reception. LRPT needs about 150 kHz of bandwidth.
- **Frequency:** 137.900 primary, 137.100 backup. In SatDump live settings, select primary for 137.9 and backup for 137.1.
- **Pipeline:** "METEOR M2-X LRPT 72k" (`meteor_m2-x_lrpt`); the 80k variant (`meteor_m2-x_lrpt_80k`) exists.
- **DC blocking:** enable it (the dongle has a centre spur).
- **Recording:** SatDump records at the **SDR's full sample rate**; supported recording formats include `cf32`,
  `cs32`, `cs16`, `cs8`, `cu8`, `w16`, and processing formats `cf32`, `cs32`, `cs16`, `cs8`, `w8`. Hence Azimuth
  records `cs8`. Keep the raw recording so it can be re-processed.
- **Frequency offset:** `freq_shift` is for fine tuning only; recording centred on the downlink needs none. (A worked
  example recorded at 137.5 MHz and needed a −0.400 MHz shift to decode 137.9.)
- **Antenna:** a V-dipole with two arms of **53.4 cm at 120°**, both **parallel to the ground** and pointing at the sky,
  with the feed point clear of metal and the coax dropping away. Outdoors or at a window with a clear sky. A QFH is a
  good omnidirectional option, especially for M2-4.
- **Interference:** keep the dongle and antenna away from computers, routers, chargers, monitors and LED lights; an
  LNA with a 137 MHz filter helps in cities with strong FM broadcast. The V4 includes broadcast notch filtering.
- **Passes:** prefer high passes with a clear horizon. A practical minimum is 10 to 15° peak elevation; above about
  30° is much better. A pass peaking near 62° decoded with a decoder SNR of about 13 dB in one worked example, and
  more than about 10 dB is a sensible target for reliable frames.
- **Timing:** start recording before the predicted rise.
- **Failure modes seen:** obstruction by a building causing mid-pass fades; "success" with zero frames (always check
  the output); black rows from dropouts are normal in small numbers.

### 4.4 RTL-SDR Blog V4 specifics

- **Bias-tee:** 4.5 V, up to 180 mA, software switchable, with over-current protection. The maker warns it can be
  damaged by a long-lived short circuit, and that it must not be enabled with a **DC-shorted antenna**, which many
  V-dipole, QFH and loop designs are. Auto-detecting an LNA by switching it on is therefore unsafe, so Azimuth makes
  antenna power a deliberate one-time Settings choice, off by default.
- **Tuner and HF:** R828D tuner, 28.8 MHz TCXO (1 ppm), built-in upconverter so the receiver covers about 0.5 MHz to
  1.766 GHz. The RTL-SDR Blog `librtlsdr` fork handles the upconverter offset below 28.8 MHz automatically.
- **Gain steps** (R828D, dB): 0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28.0,
  29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48.0, 49.6.

### 4.5 Data-source behaviour worth knowing

- CelesTrak's `NAME=METEOR-M` query **omits Meteor-M2 4**; query by NORAD ID (`CATNR=`) instead. CATNR queries
  occasionally return HTTP 500 transiently, hence the SatNOGS TLE fallback
  (`db.satnogs.org/api/tle/?norad_cat_id=`).
- SatNOGS observations (`network.satnogs.org/api/observations/?norad_cat_id=...&status=good`) carry the downlink
  frequency and a vetted status; the satellite filter parameter is `norad_cat_id`, not `satellite__norad_cat_id`
  (which is silently ignored).
- `satellite.js` v7 re-exports an optional WebAssembly API that imports Node's `node:module`; Metro cannot bundle it.
  `metro.config.js` substitutes an empty module for that one import.

---

## 5. Problems found and fixed along the way

| Symptom | Cause | Fix |
|---|---|---|
| Connection reported "initialisation failed (driver code 5.4e18)" although the dongle opened | Raw pointers returned as `jlong` look negative on arm64 (tagged heap pointers) and collided with error codes | Small integer handles with a session registry |
| FM voice sounded robotic | Blocking `read_sync` left gaps while processing, so the dongle overflowed; also unoptimised native code in debug builds | Async reader with queued transfers; `-O3` forced for native DSP |
| Signal meter showed "good" at 8 dB with nothing overhead | Compared the centre with the median of the whole band; an RTL passband is stronger in the middle | Local noise reference, second-lowest-bin rule, shape check |
| Stop stream felt frozen, Tune seemed ignored | Whole screens re-rendered at 30 Hz including the frequency text box; no bounded waits | Spectrum isolated in its own component and drawn as one SVG path; frame gate; text box owns its state; bounded native stop; timeouts |
| LRPT would have used the tuner's AGC | Default gain mode was automatic | Always manual gain, chosen by sweep |
| M2-4 missing from tracking | CelesTrak name query omits it | Query by NORAD ID |
| JS bundle failed | `satellite.js` WASM import | Metro resolver override |
| Capture recorded only a narrow slice | Compact decimated format was the only option | Full-band raw mode added and made the default |

Also investigated: a spike near 137.62 MHz seen indoors with no satellite overhead. That is NOAA 15's frequency, but
NOAA 15 (and every other 137 MHz weather satellite) was below the horizon, so it was treated as local interference or
a receiver spur. The retune test (move the centre and see whether the hump moves) separates a real RF signal from one
generated inside the receiver chain.

---

## 6. Known limitations

- Android only. No iOS; the web build is stubs.
- Capture is manual (no automatic start at AOS).
- No in-app decoder yet: images come from SatDump on a computer.
- Full-band recordings are large (about 2.8 GB per 10 minutes); Compact is available in Settings.
- Gain is automatic or fixed; PPM correction is not exposed.
- The signal meter is an indicator, not a calibrated measurement.
- Share of app-private files may be refused on some devices; use Export.
- Testing mode (on by default while developing) unlocks Capture at any time for 2-minute flagged test recordings;
  turn it off in Settings when finished.

---

## 7. Next steps

1. **First real pass** with a proper 137 MHz antenna outdoors: record, check gap count, decode in SatDump, and compare
   against a laptop recording of the same pass.
2. Tune the auto-gain thresholds from what real passes show.
3. Log the signal level through the pass into the metadata so quality can be judged afterwards.
4. Name the strongest signal in view in the Signal card (for example "137.62 MHz, 280 kHz from target, not LRPT") and
   add an automatic retune test to tell external interference from receiver spurs.
5. Optional automatic start at AOS.
6. In-app LRPT decoding (QPSK demodulation, Viterbi, Reed-Solomon, image assembly) reading the recording format above.

---

## 8. Sources

- RTL-SDR.com: [Receiving Meteor-M N2 LRPT with an RTL-SDR](https://www.rtl-sdr.com/rtl-sdr-tutorial-receiving-meteor-m-n2-lrpt-weather-satellite-images-rtl-sdr/),
  [Meteor M2-3 in orbit](https://www.rtl-sdr.com/meteor-m2-3-now-in-orbit-and-transmitting-weather-images/),
  [Meteor M2-4 deployed](https://www.rtl-sdr.com/meteor-m2-4-successfully-deployed-to-orbit-and-now-transmitting-weather-images/),
  [Meteor M2-3 reception video](https://www.rtl-sdr.com/video-on-meteor-m2-3-lrpt-hrpt-and-telemetry-reception/)
- [SDRstore: SatDump v2 with RTL-SDR beginner guide](https://www.sdrstore.eu/satdump-v2-rtl-sdr-complete-beginner-setup-guide/)
- [Meteor M2-4: from signal to image](https://gdamdam.github.io/meteor-satellite-reception/meteor-m2-4-2026-09-23.html)
- [VU3DXR: Meteor-M2 reception guide](https://vu3dxr.in/how-to-receive-stunning-weather-images-from-meteor-m2-satellites/)
- [SatDump](https://www.satdump.org/) and its [README](https://github.com/SatDump/SatDump) and
  [pipeline documentation](https://docs.satdump.org/md_docs_2pages_2Pipelines.html)
- [SatNOGS DB: Meteor M2-4](https://db.satnogs.org/satellite/59051) and [Meteor M2-3](https://db.satnogs.org/satellite/TLCE-8079-2988-7210-7028/)
- [RTL-SDR Blog V4 datasheet](https://www.rtl-sdr.com/wp-content/uploads/2024/12/RTLSDR_V4_Datasheet_V_1_0.pdf)
- [CelesTrak GP data](https://celestrak.org/)
