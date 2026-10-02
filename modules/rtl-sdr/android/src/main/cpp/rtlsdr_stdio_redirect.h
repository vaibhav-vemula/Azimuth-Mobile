#ifndef AZIMUTH_RTLSDR_STDIO_REDIRECT_H
#define AZIMUTH_RTLSDR_STDIO_REDIRECT_H

#include <android/log.h>
#include <stdio.h>

/* librtlsdr reports through fprintf(stderr, ...); route it to logcat (tag "librtlsdr"). */
#define fprintf(stream, ...) ((void)(stream), __android_log_print(ANDROID_LOG_INFO, "librtlsdr", __VA_ARGS__))

#endif
