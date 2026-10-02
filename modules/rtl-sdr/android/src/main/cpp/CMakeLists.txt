cmake_minimum_required(VERSION 3.22.1)
project(rtlsdr_jni C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(LIBUSB_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/third_party/libusb)
set(RTLSDR_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/third_party/librtlsdr)

add_library(usb1.0 STATIC
  ${LIBUSB_ROOT}/libusb/core.c
  ${LIBUSB_ROOT}/libusb/descriptor.c
  ${LIBUSB_ROOT}/libusb/hotplug.c
  ${LIBUSB_ROOT}/libusb/io.c
  ${LIBUSB_ROOT}/libusb/sync.c
  ${LIBUSB_ROOT}/libusb/strerror.c
  ${LIBUSB_ROOT}/libusb/os/linux_usbfs.c
  ${LIBUSB_ROOT}/libusb/os/events_posix.c
  ${LIBUSB_ROOT}/libusb/os/threads_posix.c
  ${LIBUSB_ROOT}/libusb/os/linux_netlink.c
)
target_include_directories(usb1.0
  PUBLIC ${LIBUSB_ROOT}/libusb
  PRIVATE ${LIBUSB_ROOT}/android ${LIBUSB_ROOT}/libusb/os
)
target_compile_options(usb1.0 PRIVATE -fvisibility=hidden -pthread -w -O2)
target_link_libraries(usb1.0 PUBLIC log)

add_library(rtlsdr STATIC
  ${RTLSDR_ROOT}/src/librtlsdr.c
  ${RTLSDR_ROOT}/src/tuner_e4k.c
  ${RTLSDR_ROOT}/src/tuner_fc0012.c
  ${RTLSDR_ROOT}/src/tuner_fc0013.c
  ${RTLSDR_ROOT}/src/tuner_fc2580.c
  ${RTLSDR_ROOT}/src/tuner_r82xx.c
)
target_include_directories(rtlsdr PUBLIC ${RTLSDR_ROOT}/include)
target_compile_definitions(rtlsdr PUBLIC rtlsdr_STATIC)
target_compile_options(rtlsdr PRIVATE
  -w
  -O2
  -include ${CMAKE_CURRENT_SOURCE_DIR}/rtlsdr_stdio_redirect.h
)
target_link_libraries(rtlsdr PUBLIC usb1.0)

add_library(rtlsdr_jni SHARED
  rtlsdr_jni.cpp
  spectrum.cpp
  fm_demod.cpp
  iq_recorder.cpp
)
# Gradle debug builds default to -O0, which is far too slow for real-time DSP; always optimize.
target_compile_options(rtlsdr_jni PRIVATE -Wall -Wextra -fvisibility=hidden -O3 -ffast-math -DNDEBUG)
target_link_libraries(rtlsdr_jni PRIVATE rtlsdr usb1.0 log)
target_link_options(rtlsdr_jni PRIVATE -Wl,-z,max-page-size=16384 -Wl,--exclude-libs,ALL)
