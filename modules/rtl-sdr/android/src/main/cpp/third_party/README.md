# Vendored third-party code

| Component | Version | License | Source |
|-----------|---------|---------|--------|
| librtlsdr (RTL-SDR Blog fork, V4 / R828D upconverter support) | commit `aed0ea19f3a273370a13c9009b96313c75d54c7b` | GPL-2.0-or-later (`librtlsdr/COPYING`) | https://github.com/rtlsdrblog/rtl-sdr-blog |
| libusb | v1.0.27 | LGPL-2.1-or-later (`libusb/COPYING`) | https://github.com/libusb/libusb |

## Local modifications

`librtlsdr/src/librtlsdr.c` and `librtlsdr/include/rtl-sdr.h` carry an `AZIMUTH PATCH`:
`rtlsdr_open()` now delegates to `rtlsdr_open_impl(..., sys_fd)`, and a new `rtlsdr_open_fd()`
wraps an Android `UsbDeviceConnection` file descriptor with `libusb_wrap_sys_device()`
(`LIBUSB_OPTION_NO_DEVICE_DISCOVERY`) instead of enumerating the bus, which Android's sandbox forbids.

libusb is unmodified; only the files needed for the Linux/Android backend are included.

## Licensing note

librtlsdr is GPL-licensed and is statically linked into `librtlsdr_jni.so`. Distributing the app
binary therefore requires publishing the app's corresponding source under a GPL-compatible license.
