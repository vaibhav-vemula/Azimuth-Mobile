// Host-side checks for the native DSP (spectrum, FM demodulator, baseband recorder).
// Build and run with tests/run.sh; exits non-zero if any check fails.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <string>
#include <vector>

#include "fm_demod.h"
#include "iq_recorder.h"
#include "spectrum.h"

static int gFailures = 0;
static int gChecks = 0;

#define CHECK(cond, ...)                                  \
  do {                                                    \
    ++gChecks;                                            \
    if (!(cond)) {                                        \
      ++gFailures;                                        \
      std::printf("  FAIL %s:%d  %s  -> ", __FILE__, __LINE__, #cond); \
      std::printf(__VA_ARGS__);                           \
      std::printf("\n");                                  \
    }                                                     \
  } while (0)

static uint8_t quantize(double x) {
  const double r = std::round(127.5 + 127.5 * x);
  return static_cast<uint8_t>(std::fmin(255.0, std::fmax(0.0, r)));
}

// ---- spectrum ---------------------------------------------------------------------------------

static std::vector<uint8_t> complexTone(double fractionOfRate, double amplitude, double noiseSd, int samples) {
  std::mt19937 gen(1);
  std::normal_distribution<double> noise(0.0, noiseSd);
  std::vector<uint8_t> iq(static_cast<size_t>(samples) * 2);
  for (int i = 0; i < samples; ++i) {
    const double phase = 2.0 * M_PI * fractionOfRate * i;
    iq[2 * i] = quantize(amplitude * std::cos(phase) + noise(gen));
    iq[2 * i + 1] = quantize(amplitude * std::sin(phase) + noise(gen));
  }
  return iq;
}

static void testSpectrum() {
  std::puts("spectrum");
  azimuth::SpectrumAnalyzer analyzer;
  float bins[64];

  for (double fraction : {0.25, -0.25}) {
    auto iq = complexTone(fraction, 0.5, 0.02, 1024 * 32);
    CHECK(analyzer.process(iq.data(), iq.size(), -70.f, -20.f, bins), "process returned false");
    int peak = 0;
    for (int i = 1; i < 64; ++i) if (bins[i] > bins[peak]) peak = i;
    const int expected = fraction > 0 ? 48 : 16;
    CHECK(peak == expected, "tone %+.2f peaked in bin %d, expected %d", fraction, peak, expected);
    CHECK(bins[peak] > 0.99f, "peak level %.3f", bins[peak]);
  }

  auto dc = complexTone(0.0, 0.5, 0.02, 1024 * 32);
  analyzer.process(dc.data(), dc.size(), -70.f, -20.f, bins);
  float centreMax = 0;
  for (int i = 30; i <= 33; ++i) centreMax = std::fmax(centreMax, bins[i]);
  CHECK(centreMax < 0.4f, "DC spike not suppressed (%.3f)", centreMax);

  auto noiseOnly = complexTone(0.1, 0.0, 0.02, 1024 * 32);
  analyzer.process(noiseOnly.data(), noiseOnly.size(), -70.f, -20.f, bins);
  float lo = 1, hi = 0;
  for (float v : bins) { lo = std::fmin(lo, v); hi = std::fmax(hi, v); }
  CHECK(hi - lo < 0.1f, "noise floor not flat (%.3f..%.3f)", lo, hi);

  CHECK(!analyzer.process(noiseOnly.data(), 100, -70.f, -20.f, bins), "short block should be rejected");
}

// ---- FM demodulator ---------------------------------------------------------------------------

static std::vector<int16_t> fmAudio(double toneHz, double deviationHz, double amplitude, double noiseSd,
                                    int blocks, double carrierOffsetHz = 0.0) {
  const double fs = 2400000.0;
  const int block = 32000;
  azimuth::FmDemodulator demod;
  std::mt19937 gen(7);
  std::normal_distribution<double> noise(0.0, noiseSd);
  std::vector<int16_t> audio;
  double phase = 0;
  long t = 0;
  for (int b = 0; b < blocks; ++b) {
    std::vector<uint8_t> iq(static_cast<size_t>(block) * 2);
    for (int i = 0; i < block; ++i, ++t) {
      phase += 2.0 * M_PI * (carrierOffsetHz + deviationHz * std::sin(2.0 * M_PI * toneHz * t / fs)) / fs;
      iq[2 * i] = quantize(amplitude * std::cos(phase) + noise(gen));
      iq[2 * i + 1] = quantize(amplitude * std::sin(phase) + noise(gen));
    }
    int16_t out[1024];
    const size_t n = demod.process(iq.data(), iq.size(), out, 1024);
    CHECK(n == 640, "block %d produced %zu samples, expected 640", b, n);
    if (b >= 3) audio.insert(audio.end(), out, out + n);
  }
  return audio;
}

static double amplitudeAt(const std::vector<int16_t>& a, double hz) {
  double c = 0, s = 0;
  for (size_t i = 0; i < a.size(); ++i) {
    const double w = 2.0 * M_PI * hz * i / 48000.0;
    c += a[i] * std::cos(w);
    s += a[i] * std::sin(w);
  }
  return 2.0 * std::sqrt(c * c + s * s) / a.size();
}

static void testFm() {
  std::puts("fm demodulator");
  const double expected = 0.8 * 32767.0 * 0.905;  // output level x 75 us de-emphasis gain at 1 kHz

  auto tone = fmAudio(1000, 75000, 0.5, 0.005, 20);
  const double a1k = amplitudeAt(tone, 1000);
  CHECK(std::fabs(a1k - expected) < 0.03 * expected, "1 kHz amplitude %.0f, expected ~%.0f", a1k, expected);

  CHECK(amplitudeAt(fmAudio(440, 75000, 0.5, 0.005, 20), 1000) < 0.01 * expected, "440 Hz tone leaked into 1 kHz");

  const double pilot = amplitudeAt(fmAudio(19000, 7500, 0.5, 0.005, 20), 19000);
  const double ref = amplitudeAt(fmAudio(1000, 7500, 0.5, 0.005, 20), 1000);
  CHECK(20.0 * std::log10(std::fmax(pilot, 1e-9) / ref) < -50.0, "19 kHz pilot rejection only %.1f dB", 20.0 * std::log10(pilot / ref));

  const double weak = amplitudeAt(fmAudio(1000, 75000, 0.1, 0.003, 20), 1000);
  CHECK(std::fabs(weak - a1k) < 0.03 * a1k, "level depends on signal strength (%.0f vs %.0f)", weak, a1k);

  const double offset = amplitudeAt(fmAudio(1000, 75000, 0.5, 0.005, 20, 30000), 1000);
  CHECK(std::fabs(offset - a1k) < 0.05 * a1k, "30 kHz tuning offset changed the level (%.0f)", offset);

  int maxStep = 0;
  for (size_t i = 1; i < tone.size(); ++i) maxStep = std::max(maxStep, std::abs(tone[i] - tone[i - 1]));
  const double sineMaxStep = a1k * 2.0 * M_PI * 1000.0 / 48000.0;
  CHECK(maxStep < 1.1 * sineMaxStep, "glitch at block boundary: step %d vs %.0f", maxStep, sineMaxStep);
}

// ---- baseband recorder ------------------------------------------------------------------------

static std::vector<int8_t> readFile(const char* path) {
  std::vector<int8_t> data;
  if (FILE* f = std::fopen(path, "rb")) {
    int8_t buffer[65536];
    size_t n;
    while ((n = std::fread(buffer, 1, sizeof buffer, f)) > 0) data.insert(data.end(), buffer, buffer + n);
    std::fclose(f);
  }
  return data;
}

static double recordedToneAmp(const std::vector<int8_t>& d, double hz, size_t skip) {
  const double fs = 288000.0;
  double cr = 0, ci = 0;
  size_t count = 0;
  for (size_t i = skip; i < d.size() / 2; ++i, ++count) {
    const double ph = -2.0 * M_PI * hz * i / fs;
    const double I = d[2 * i], Q = d[2 * i + 1];
    cr += I * std::cos(ph) - Q * std::sin(ph);
    ci += I * std::sin(ph) + Q * std::cos(ph);
  }
  return std::sqrt(cr * cr + ci * ci) / count;
}

static double recordedRms(const std::vector<int8_t>& d, size_t skip) {
  double e = 0;
  size_t count = 0;
  for (size_t i = skip; i < d.size() / 2; ++i, ++count) e += double(d[2 * i]) * d[2 * i] + double(d[2 * i + 1]) * d[2 * i + 1];
  return std::sqrt(e / (2.0 * count));
}

static std::vector<uint8_t> recorderBlock(double tone1Hz, double amp1, double tone2Hz, double amp2, double noiseSd,
                                          long& t, std::mt19937& gen) {
  const double fs = 2304000.0;
  std::normal_distribution<double> noise(0.0, noiseSd);
  std::vector<uint8_t> iq(32000 * 2);
  for (int i = 0; i < 32000; ++i, ++t) {
    const double p1 = 2.0 * M_PI * tone1Hz * t / fs, p2 = 2.0 * M_PI * tone2Hz * t / fs;
    iq[2 * i] = quantize(noise(gen) + amp1 * std::cos(p1) + amp2 * std::cos(p2));
    iq[2 * i + 1] = quantize(noise(gen) + amp1 * std::sin(p1) + amp2 * std::sin(p2));
  }
  return iq;
}

static void testRecorder() {
  std::puts("baseband recorder");
  const char* path = "/tmp/azimuth_dsp_test.cs8";
  std::mt19937 gen(3);

  {
    azimuth::IqRecorder recorder;
    CHECK(recorder.open(path), "open failed");
    long t = 0;
    const int blocks = 300;
    for (int b = 0; b < blocks; ++b) {
      auto iq = recorderBlock(50000, 0.05, 200000, 0.05, 0.02, t, gen);
      CHECK(recorder.process(iq.data(), iq.size()), "process failed at block %d", b);
    }
    recorder.close();
    auto data = readFile(path);
    CHECK(data.size() == static_cast<size_t>(blocks) * 4000 * 2, "file is %zu bytes", data.size());
    CHECK(recorder.bytesWritten() == data.size(), "bytesWritten() disagrees with the file");

    const double inBand = recordedToneAmp(data, 50000, 20000);
    const double mirror = recordedToneAmp(data, -50000, 20000);
    const double alias = recordedToneAmp(data, 200000 - 288000, 20000);
    CHECK(inBand > 10.0, "in-band tone missing (%.2f)", inBand);
    CHECK(20.0 * std::log10(inBand / std::fmax(mirror, 1e-9)) > 50.0, "mirror image only %.0f dB down", 20.0 * std::log10(inBand / mirror));
    CHECK(20.0 * std::log10(inBand / std::fmax(alias, 1e-9)) > 50.0, "alias only %.0f dB down", 20.0 * std::log10(inBand / alias));
  }

  for (double sd : {0.01, 0.05, 0.2}) {
    azimuth::IqRecorder recorder;
    recorder.open(path);
    long t = 0;
    for (int b = 0; b < 600; ++b) {
      auto iq = recorderBlock(0, 0, 0, 0, sd, t, gen);
      recorder.process(iq.data(), iq.size());
    }
    recorder.close();
    auto data = readFile(path);
    const double rms = recordedRms(data, data.size() / 4);
    CHECK(rms > 21.5 && rms < 26.5, "AGC output RMS %.1f for input sd %.2f (target 24)", rms, sd);
  }

  {
    azimuth::IqRecorder recorder;
    recorder.open(path);
    long t = 0;
    for (int b = 0; b < 400; ++b) {
      auto iq = recorderBlock(30000, 0.9, 0, 0, 0.01, t, gen);
      recorder.process(iq.data(), iq.size());
    }
    recorder.close();
    int peak = 0;
    bool sawMin = false;
    for (int8_t v : readFile(path)) { peak = std::max(peak, std::abs(int(v))); sawMin |= (v == -128); }
    CHECK(peak <= 127, "sample magnitude %d", peak);
    CHECK(!sawMin, "wrote -128, which decoders treat inconsistently");
  }

  {
    azimuth::IqRecorder recorder;
    CHECK(!recorder.open("/nonexistent_dir/x.cs8"), "opened a path in a missing directory");
    CHECK(recorder.lastError() != 0, "no error recorded");
    std::vector<uint8_t> iq(64000, 128);
    CHECK(!recorder.process(iq.data(), iq.size()), "process succeeded while closed");
  }

  {
    azimuth::IqRecorder whole, sliced;
    whole.open(path);
    sliced.open("/tmp/azimuth_dsp_test_sliced.cs8");
    std::vector<uint8_t> all;
    long t = 0;
    for (int i = 0; i < 40; ++i) { auto b = recorderBlock(40000, 0.1, 0, 0, 0.02, t, gen); all.insert(all.end(), b.begin(), b.end()); }
    whole.process(all.data(), all.size());
    const size_t chunks[] = {1000, 6, 12345 * 2, 2, 777 * 2};
    size_t pos = 0;
    int c = 0;
    while (pos < all.size()) {
      const size_t n = std::min(chunks[c++ % 5], all.size() - pos);
      sliced.process(all.data() + pos, n);
      pos += n;
    }
    whole.close();
    sliced.close();
    CHECK(readFile(path).size() == readFile("/tmp/azimuth_dsp_test_sliced.cs8").size(), "output length depends on how input is sliced");
  }
}

int main() {
  testSpectrum();
  testFm();
  testRecorder();
  std::printf("\n%d checks, %d failed\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
