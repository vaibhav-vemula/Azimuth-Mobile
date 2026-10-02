# Azimuth V1

A Software Defined Radio receiver for Android. Plug an RTL-SDR dongle into your phone over USB-OTG, tune a frequency, and watch a live 64-bin spectrum analyzer.

Built with Expo (SDK 53), a local Expo native module written in Kotlin, and the RTL-SDR Blog `librtlsdr` driver compiled in through the NDK.

> **Status:** compiles and builds for Android, but has not yet been tested on a physical device with a dongle. See [Known limitations](#known-limitations).

## Hardware

- Android phone with USB host (OTG) support, Android 6.0+ (API 23)
- RTL-SDR dongle. Developed against the **RTL-SDR Blog V4** (RTL2832U + R828D), which receives roughly 0.5 MHz to 1766 MHz.
- USB-OTG adapter or cable

Also recognized: Realtek `0x0BDA` with product ID `0x2832` / `0x2838`, and vendor `0x0245`.

## Requirements

- Node.js 18+
- JDK 17 or 21
- Android SDK with an NDK (r26 or r27) and CMake 3.22.1 (install via Android Studio's SDK Manager)
- `ANDROID_HOME` set

This is a **development build**. It will not run in Expo Go because it uses a local native module.

## Run

```bash
npm install
npx expo run:android
```

With the app installed and the dev server running:

```bash
npm start
```

Plug in the dongle, tap **CONNECT**, and accept the USB permission prompt. Then enter a frequency in MHz, tap **TUNE**, and tap **START STREAM**.

To hear an FM station, tune to it (88 to 108 MHz) and tap **LISTEN**. This turns on audio and starts the stream if it isn't running. Use the − and + buttons for volume.

If versions drift, run `npx expo install --fix`.

## Project layout

```
azimuth-v1/
├── App.tsx                          UI: status banner, tuning input, controls
├── src/components/
│   └── SpectrumVisualizer.tsx       64-bar spectrum card (cyan -> red by power)
└── modules/rtl-sdr/
    ├── index.ts                     Typed wrappers + addSignalListener / addStatusListener
    ├── expo-module.config.json
    ├── src/
    │   ├── RtlSdrModule.ts          requireNativeModule('rtl-sdr')
    │   ├── RtlSdrModule.web.ts      Web stubs (warn + throw)
    │   └── RtlSdrModule.types.ts    Event and module types
    └── android/
        ├── build.gradle             Library + CMake/NDK config
        └── src/main/
            ├── java/expo/modules/rtlsdr/
            │   ├── RtlSdrModule.kt  USB discovery, permissions, lifecycle, stream thread
            │   └── RtlSdrNative.kt  JNI declarations
            └── cpp/
                ├── rtlsdr_jni.cpp   JNI bridge
                ├── spectrum.cpp/.h  Hann window + 1024-pt FFT -> 64 bins
                ├── fm_demod.cpp/.h  Wideband FM demodulator -> 48 kHz mono PCM
                └── third_party/     librtlsdr (Blog fork, patched) + libusb 1.0.27
```

## How it works

1. Kotlin finds the dongle via `UsbManager`, requests USB permission, and opens a `UsbDeviceConnection`.
2. The connection's file descriptor is passed to a patched `librtlsdr` (`rtlsdr_open_fd`). Android's sandbox blocks libusb from enumerating the bus, so the descriptor is wrapped instead.
3. The driver samples at 2.4 MS/s with auto gain. Below 28.8 MHz the V4's built-in upconverter is handled by the driver.
4. A background thread reads IQ blocks. Each block is run through a Hann-windowed FFT, averaged, DC-spike-suppressed, and reduced to 64 bins in dBFS, then scaled to 0..1.
5. Bins are emitted to JS as `onSignalData` at up to 30 FPS. Connection changes are emitted as `onStatusChange`.
6. When audio is on, the same IQ block is also demodulated (see below) and played through `AudioTrack`.

The visible span is the tuned frequency plus or minus 1.2 MHz.

## FM audio

Each 13.3 ms IQ block (32000 samples) goes through a mono wideband-FM chain in `fm_demod.cpp`:

1. 127-tap low-pass (110 kHz) and decimate by 10 to 240 kS/s
2. Quadrature discriminator (phase difference between consecutive samples)
3. 129-tap low-pass (16 kHz, which also removes the 19 kHz stereo pilot) and decimate by 5 to 48 kS/s
4. 75 µs de-emphasis (North America; use 50 µs elsewhere by changing the `FmDemodulator` constructor argument)
5. 16-bit PCM, exactly 640 samples per block

Playback uses `AudioTrack` with non-blocking writes. A slow audio device can drop audio but can never stall the USB reads, which would corrupt the IQ stream.

Audio is mono. Stereo decoding, RDS, and AM/narrowband-FM modes are not implemented.

## JavaScript API

```ts
import {
  connect, disconnect, tune, startStream, stopStream,
  addSignalListener, addStatusListener,
} from './modules/rtl-sdr';

const status = addStatusListener(({ status, deviceName, frequency }) => { /* ... */ });
const signal = addSignalListener(({ bins }) => { /* 64 floats, 0..1 */ });

await connect();
await tune(98_500_000);   // Hz
await startStream();
await setAudioEnabled(true);   // hear FM while streaming
await setVolume(0.8);          // 0..1
// ...
await stopStream();
await disconnect();

status.remove();
signal.remove();
```

| Function | Description |
|----------|-------------|
| `connect()` | Finds the dongle, requests permission, opens and initializes it |
| `tune(frequencyHz)` | Sets center frequency (500 kHz to 1766 MHz) |
| `startStream()` / `stopStream()` | Starts or stops the spectrum stream |
| `disconnect()` | Stops streaming and releases the device |
| `setAudioEnabled(enabled)` | Plays demodulated wideband-FM audio while a stream is running |
| `setVolume(volume)` | Output volume, 0 to 1 |

Status values: `disconnected`, `connecting`, `connected`, `streaming`, `error`.

Errors are rejected with codes such as `ERR_RTLSDR_NO_DEVICE`, `ERR_RTLSDR_PERMISSION`, `ERR_RTLSDR_OPEN_FAILED`, `ERR_RTLSDR_NOT_CONNECTED`, `ERR_RTLSDR_FREQUENCY`.

## Tuning the display

Bar height maps a dBFS range onto 0..1. The defaults are in `RtlSdrModule.kt`:

```kotlin
private const val DISPLAY_FLOOR_DB = -70f
private const val DISPLAY_CEIL_DB = -20f
```

Lower the floor if weak signals are clipped, raise it if the noise floor is too high.

## Debugging

```bash
adb logcat -s RtlSdrJni librtlsdr RtlSdrModule
```

`librtlsdr`'s own messages (tuner detection, "RTL-SDR Blog V4 Detected") appear under the `librtlsdr` tag.

## Known limitations

- Not yet validated on real hardware.
- Android only. The module config lists `apple`, but there is no iOS implementation, and the web build uses stubs that throw.
- Fixed sample rate (2.4 MS/s) and automatic gain. Manual gain, bias-tee, and PPM correction are supported by `librtlsdr` but not exposed yet.
- Audio is wideband FM only (mono). No AM, narrowband FM, SSB, or stereo/RDS decoding.

## License

`librtlsdr` is GPL-2.0-or-later and is statically linked into the native library, so distributing a built app requires releasing its source under a GPL-compatible license. libusb is LGPL-2.1-or-later. Provenance, versions, and the exact local patch are documented in `modules/rtl-sdr/android/src/main/cpp/third_party/README.md`.
