#!/bin/sh
# Builds and runs the host-side DSP checks. Needs only a C++17 compiler (no Android tooling).
set -e
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/azimuth_dsp_tests"
${CXX:-c++} -std=c++17 -O2 -Wall -Wextra -I. spectrum.cpp fm_demod.cpp iq_recorder.cpp tests/dsp_tests.cpp -o "$OUT"
"$OUT"
