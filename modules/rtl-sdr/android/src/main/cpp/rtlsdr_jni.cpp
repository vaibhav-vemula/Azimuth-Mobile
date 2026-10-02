#include <android/log.h>
#include <jni.h>

#include <atomic>
#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include <unistd.h>
#include <unordered_map>
#include <vector>

#include "fm_demod.h"
#include "iq_recorder.h"
#include "rtl-sdr.h"
#include "spectrum.h"

#define LOG_TAG "RtlSdrJni"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

constexpr uint32_t kSampleRateHz = 2400000;
constexpr uint32_t kDefaultCenterHz = 100000000;

// 32000 IQ samples (13.33 ms): a multiple of 512 bytes for USB, of the 50x audio decimation
// (-> exactly 640 PCM samples), and holding 31 whole 1024-point FFT segments.
constexpr int kBlockBytes = 64000;
constexpr int kMaxAudioSamples = kBlockBytes / 2 / 50;

// Sixteen transfers stay queued on the USB controller at all times, so the dongle never
// overflows while a block is being processed.
constexpr uint32_t kAsyncTransferCount = 16;
constexpr size_t kMaxQueuedBlocks = 24;
constexpr std::chrono::milliseconds kReadTimeout(500);
// A healthy reader exits within a few USB blocks (~14 ms each). If it has not after this long it is stuck.
constexpr std::chrono::milliseconds kReaderStopDeadline(3000);

struct Session {
  rtlsdr_dev_t* dev = nullptr;

  // Serializes control transfers (tuning etc.) with close. Never held while waiting for data.
  std::mutex devMutex;
  // Serializes start/stop of the reader thread.
  std::mutex readerControlMutex;

  // Used only by the thread calling nativeReadBlock.
  azimuth::SpectrumAnalyzer analyzer;
  azimuth::FmDemodulator demodulator;
  bool demodulatorActive = false;
  azimuth::IqRecorder recorder;
  uint64_t recordingDroppedBaseline = 0;

  std::thread reader;
  std::atomic<bool> readerExited{true};
  std::atomic<bool> stopRequested{false};
  // Set when the reader thread could not be stopped in time. rtlsdr_close() would wait for it forever.
  std::atomic<bool> readerStuck{false};

  std::mutex queueMutex;
  std::condition_variable queueCv;
  std::deque<std::vector<uint8_t>> queue;
  bool readerRunning = false;
  bool readerFailed = false;
  uint64_t droppedBlocks = 0;
};

// Handles are small positive ids rather than raw pointers: arm64 heap pointers can carry a tag in
// the top byte, which makes them look negative as a signed jlong and collide with error codes.
// Sessions whose reader thread is stuck are kept alive on purpose: that thread still points into them.
std::mutex gStuckMutex;
std::vector<std::shared_ptr<Session>> gStuckSessions;

std::mutex gRegistryMutex;
std::unordered_map<jlong, std::shared_ptr<Session>> gSessions;
jlong gNextHandle = 1;

std::shared_ptr<Session> fromHandle(jlong handle) {
  std::lock_guard<std::mutex> guard(gRegistryMutex);
  auto it = gSessions.find(handle);
  return it == gSessions.end() ? nullptr : it->second;
}

jlong registerSession(std::shared_ptr<Session> session) {
  std::lock_guard<std::mutex> guard(gRegistryMutex);
  const jlong handle = gNextHandle++;
  gSessions.emplace(handle, std::move(session));
  return handle;
}

std::shared_ptr<Session> takeSession(jlong handle) {
  std::lock_guard<std::mutex> guard(gRegistryMutex);
  auto it = gSessions.find(handle);
  if (it == gSessions.end()) return nullptr;
  std::shared_ptr<Session> session = std::move(it->second);
  gSessions.erase(it);
  return session;
}

const char* tunerName(int type) {
  switch (type) {
    case RTLSDR_TUNER_E4000:
      return "E4000";
    case RTLSDR_TUNER_FC0012:
      return "FC0012";
    case RTLSDR_TUNER_FC0013:
      return "FC0013";
    case RTLSDR_TUNER_FC2580:
      return "FC2580";
    case RTLSDR_TUNER_R820T:
      return "R820T";
    case RTLSDR_TUNER_R828D:
      return "R828D";
    default:
      return "unknown tuner";
  }
}

void onAsyncData(unsigned char* buf, uint32_t len, void* ctx) {
  auto* session = static_cast<Session*>(ctx);
  if (session->stopRequested.load()) return;

  std::lock_guard<std::mutex> guard(session->queueMutex);
  if (session->queue.size() >= kMaxQueuedBlocks) {
    session->queue.pop_front();
    session->droppedBlocks++;
  }
  session->queue.emplace_back(buf, buf + len);
  session->queueCv.notify_one();
}

int startReader(const std::shared_ptr<Session>& session) {
  std::lock_guard<std::mutex> control(session->readerControlMutex);
  if (session->readerStuck.load()) return -EBUSY;
  if (!session->readerExited.load()) return 0;
  if (session->reader.joinable()) session->reader.join();

  {
    std::lock_guard<std::mutex> dev(session->devMutex);
    if (session->dev == nullptr) return -ENODEV;
    rtlsdr_reset_buffer(session->dev);
  }
  {
    std::lock_guard<std::mutex> queue(session->queueMutex);
    session->queue.clear();
    session->readerRunning = true;
    session->readerFailed = false;
    session->droppedBlocks = 0;
  }
  session->stopRequested = false;
  session->readerExited = false;

  Session* raw = session.get();
  session->reader = std::thread([raw]() {
    const int result = rtlsdr_read_async(raw->dev, onAsyncData, raw, kAsyncTransferCount, kBlockBytes);
    {
      std::lock_guard<std::mutex> queue(raw->queueMutex);
      raw->readerRunning = false;
      if (!raw->stopRequested.load()) {
        raw->readerFailed = true;
        LOGE("rtlsdr_read_async ended unexpectedly: %d", result);
      }
    }
    raw->readerExited = true;
    raw->queueCv.notify_all();
  });
  return 0;
}

void stopReader(const std::shared_ptr<Session>& session) {
  std::lock_guard<std::mutex> control(session->readerControlMutex);
  if (!session->reader.joinable()) return;

  const auto startedAt = std::chrono::steady_clock::now();
  session->stopRequested = true;
  // rtlsdr_cancel_async is ignored until the async loop has actually started, so retry.
  while (!session->readerExited.load()) {
    {
      std::lock_guard<std::mutex> dev(session->devMutex);
      if (session->dev != nullptr) rtlsdr_cancel_async(session->dev);
    }
    session->queueCv.notify_all();

    if (std::chrono::steady_clock::now() - startedAt > kReaderStopDeadline) {
      LOGE("USB reader did not stop within %lld ms; abandoning it so the app stays responsive",
           static_cast<long long>(kReaderStopDeadline.count()));
      session->readerStuck = true;
      session->reader.detach();
      {
        std::lock_guard<std::mutex> queue(session->queueMutex);
        session->readerRunning = false;
      }
      session->queueCv.notify_all();
      std::lock_guard<std::mutex> stuck(gStuckMutex);
      gStuckSessions.push_back(session);
      return;
    }
    usleep(5000);
  }
  session->reader.join();

  uint64_t dropped;
  {
    std::lock_guard<std::mutex> queue(session->queueMutex);
    session->readerRunning = false;
    dropped = session->droppedBlocks;
  }
  session->queueCv.notify_all();
  LOGI("Reader stopped in %lld ms (%llu blocks dropped to overflow)",
       static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - startedAt).count()),
       static_cast<unsigned long long>(dropped));
}

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeOpen(JNIEnv*, jobject, jint fd) {
  rtlsdr_dev_t* dev = nullptr;
  const int openResult = rtlsdr_open_fd(&dev, fd);
  if (openResult < 0 || dev == nullptr) {
    LOGE("rtlsdr_open_fd failed: %d", openResult);
    return openResult < 0 ? openResult : -EIO;
  }

  const int result = rtlsdr_set_sample_rate(dev, kSampleRateHz);
  if (result < 0) {
    LOGE("rtlsdr_set_sample_rate failed: %d", result);
    rtlsdr_close(dev);
    return result;
  }
  rtlsdr_set_tuner_gain_mode(dev, 0);
  rtlsdr_set_center_freq(dev, kDefaultCenterHz);
  rtlsdr_reset_buffer(dev);

  auto session = std::make_shared<Session>();
  session->dev = dev;
  LOGI("Opened %s", tunerName(rtlsdr_get_tuner_type(dev)));
  return registerSession(std::move(session));
}

JNIEXPORT void JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeClose(JNIEnv*, jobject,
                                                                         jlong handle) {
  std::shared_ptr<Session> session = takeSession(handle);
  if (session == nullptr) return;

  stopReader(session);

  std::lock_guard<std::mutex> guard(session->devMutex);
  if (session->readerStuck.load()) {
    // rtlsdr_close() waits for the async reader to finish, which would hang the caller forever. Leak the
    // device instead; the USB connection is closed by the Kotlin side and the dongle can be replugged.
    LOGE("Skipping rtlsdr_close because the USB reader is stuck");
    session->dev = nullptr;
    return;
  }
  if (session->dev != nullptr) {
    rtlsdr_close(session->dev);
    session->dev = nullptr;
  }
}

JNIEXPORT jstring JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeDescribe(JNIEnv* env, jobject,
                                                                               jlong handle) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr) return nullptr;
  std::lock_guard<std::mutex> guard(session->devMutex);
  if (session->dev == nullptr) return nullptr;

  char label[96];
  const char* tuner = tunerName(rtlsdr_get_tuner_type(session->dev));
  if (rtlsdr_check_dongle_model(session->dev, const_cast<char*>("RTLSDRBlog"),
                                const_cast<char*>("Blog V4L"))) {
    std::snprintf(label, sizeof(label), "RTL-SDR Blog V4 Lite (%s)", tuner);
  } else if (rtlsdr_check_dongle_model(session->dev, const_cast<char*>("RTLSDRBlog"),
                                       const_cast<char*>("Blog V4"))) {
    std::snprintf(label, sizeof(label), "RTL-SDR Blog V4 (%s)", tuner);
  } else {
    std::snprintf(label, sizeof(label), "RTL2832U (%s)", tuner);
  }
  return env->NewStringUTF(label);
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeSetCenterFrequency(
    JNIEnv*, jobject, jlong handle, jlong frequencyHz) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr || frequencyHz <= 0 || frequencyHz > 0xFFFFFFFFLL) return -EINVAL;
  std::lock_guard<std::mutex> guard(session->devMutex);
  if (session->dev == nullptr) return -ENODEV;
  return rtlsdr_set_center_freq(session->dev, static_cast<uint32_t>(frequencyHz));
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeSetSampleRate(JNIEnv*, jobject,
                                                                                 jlong handle,
                                                                                 jint rateHz) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr || rateHz <= 0) return -EINVAL;
  std::lock_guard<std::mutex> guard(session->devMutex);
  if (session->dev == nullptr) return -ENODEV;
  const int result = rtlsdr_set_sample_rate(session->dev, static_cast<uint32_t>(rateHz));
  if (result < 0) return result;
  return static_cast<jint>(rtlsdr_get_sample_rate(session->dev));
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeSetGain(JNIEnv*, jobject,
                                                                           jlong handle,
                                                                           jint tenthsDb) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr) return -EINVAL;
  std::lock_guard<std::mutex> guard(session->devMutex);
  if (session->dev == nullptr) return -ENODEV;

  if (tenthsDb < 0) {
    return rtlsdr_set_tuner_gain_mode(session->dev, 0);
  }

  const int count = rtlsdr_get_tuner_gains(session->dev, nullptr);
  if (count <= 0) return -ENOTSUP;
  std::vector<int> gains(static_cast<size_t>(count));
  rtlsdr_get_tuner_gains(session->dev, gains.data());

  int best = gains[0];
  for (int gain : gains) {
    if (std::abs(gain - tenthsDb) < std::abs(best - tenthsDb)) best = gain;
  }
  int result = rtlsdr_set_tuner_gain_mode(session->dev, 1);
  if (result < 0) return result;
  result = rtlsdr_set_tuner_gain(session->dev, best);
  return result < 0 ? result : best;
}

JNIEXPORT jintArray JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeGetGains(JNIEnv* env, jobject,
                                                                                 jlong handle) {
  std::shared_ptr<Session> session = fromHandle(handle);
  std::vector<int> gains;
  if (session != nullptr) {
    std::lock_guard<std::mutex> guard(session->devMutex);
    if (session->dev != nullptr) {
      const int count = rtlsdr_get_tuner_gains(session->dev, nullptr);
      if (count > 0) {
        gains.resize(static_cast<size_t>(count));
        rtlsdr_get_tuner_gains(session->dev, gains.data());
      }
    }
  }
  jintArray result = env->NewIntArray(static_cast<jsize>(gains.size()));
  if (result != nullptr && !gains.empty()) {
    env->SetIntArrayRegion(result, 0, static_cast<jsize>(gains.size()), gains.data());
  }
  return result;
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeSetBiasTee(JNIEnv*, jobject,
                                                                              jlong handle,
                                                                              jboolean on) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr) return -EINVAL;
  std::lock_guard<std::mutex> guard(session->devMutex);
  if (session->dev == nullptr) return -ENODEV;
  return rtlsdr_set_bias_tee(session->dev, on ? 1 : 0);
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeStartRecording(JNIEnv* env, jobject,
                                                                                  jlong handle,
                                                                                  jstring path) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr || path == nullptr) return -EINVAL;

  {
    std::lock_guard<std::mutex> guard(session->devMutex);
    if (session->dev == nullptr) return -ENODEV;
    if (rtlsdr_get_sample_rate(session->dev) != static_cast<uint32_t>(azimuth::IqRecorder::kInputRateHz)) {
      LOGE("Recording needs %d S/s but the dongle runs at %u", azimuth::IqRecorder::kInputRateHz,
           rtlsdr_get_sample_rate(session->dev));
      return -EINVAL;
    }
  }

  const char* chars = env->GetStringUTFChars(path, nullptr);
  if (chars == nullptr) return -ENOMEM;
  const bool opened = session->recorder.open(chars);
  const int error = session->recorder.lastError();
  env->ReleaseStringUTFChars(path, chars);
  if (!opened) return error != 0 ? -error : -EIO;

  {
    std::lock_guard<std::mutex> queue(session->queueMutex);
    session->recordingDroppedBaseline = session->droppedBlocks;
  }
  return 0;
}

static jlongArray recordingStats(JNIEnv* env, Session& session) {
  uint64_t dropped;
  {
    std::lock_guard<std::mutex> queue(session.queueMutex);
    dropped = session.droppedBlocks - session.recordingDroppedBaseline;
  }
  const jlong values[4] = {
      static_cast<jlong>(session.recorder.bytesWritten()),
      static_cast<jlong>(session.recorder.samplesWritten()),
      static_cast<jlong>(dropped),
      static_cast<jlong>(session.recorder.lastError()),
  };
  jlongArray result = env->NewLongArray(4);
  if (result != nullptr) env->SetLongArrayRegion(result, 0, 4, values);
  return result;
}

JNIEXPORT jlongArray JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeGetRecordingStats(
    JNIEnv* env, jobject, jlong handle) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr) return nullptr;
  return recordingStats(env, *session);
}

JNIEXPORT jlongArray JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeStopRecording(JNIEnv* env, jobject,
                                                                                       jlong handle) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr) return nullptr;
  session->recorder.close();
  return recordingStats(env, *session);
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeStartReader(JNIEnv*, jobject,
                                                                               jlong handle) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr) return -EINVAL;
  return startReader(session);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeStopReader(JNIEnv*, jobject,
                                                                              jlong handle) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr) return;
  stopReader(session);
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlsdr_RtlSdrNative_nativeReadBlock(
    JNIEnv* env, jobject, jlong handle, jfloatArray bins, jfloatArray stats, jfloat floorDb, jfloat ceilDb,
    jshortArray audio, jboolean demodulate) {
  std::shared_ptr<Session> session = fromHandle(handle);
  if (session == nullptr || bins == nullptr) return -EINVAL;
  if (env->GetArrayLength(bins) < azimuth::SpectrumAnalyzer::kOutputBins) return -EINVAL;
  if (stats == nullptr || env->GetArrayLength(stats) < 2) return -EINVAL;
  if (demodulate && (audio == nullptr || env->GetArrayLength(audio) < kMaxAudioSamples)) {
    return -EINVAL;
  }

  std::vector<uint8_t> block;
  {
    std::unique_lock<std::mutex> lock(session->queueMutex);
    const bool ready = session->queueCv.wait_for(
        lock, kReadTimeout, [&]() { return !session->queue.empty() || !session->readerRunning; });
    if (!ready) return -ETIMEDOUT;
    if (session->queue.empty()) return session->readerFailed ? -EIO : -ECANCELED;
    block = std::move(session->queue.front());
    session->queue.pop_front();
  }

  // ADC loading for the auto gain control: RMS level (0..1 of full scale) and the fraction of samples that
  // sit on the converter's rails, which means the front end is overloaded.
  float adc[2] = {0.0f, 0.0f};
  {
    const uint8_t* p = block.data();
    const size_t n = block.size();
    double sum = 0.0;
    size_t railed = 0;
    for (size_t i = 0; i < n; ++i) {
      const float d = static_cast<float>(p[i]) - 127.5f;
      sum += static_cast<double>(d) * d;
      if (p[i] == 0 || p[i] == 255) ++railed;
    }
    if (n > 0) {
      adc[0] = static_cast<float>(std::sqrt(sum / static_cast<double>(n)) / 127.5);
      adc[1] = static_cast<float>(railed) / static_cast<float>(n);
    }
  }

  // Recording happens before any display work so a slow UI can never cost recorded samples.
  session->recorder.process(block.data(), block.size());

  float spectrum[azimuth::SpectrumAnalyzer::kOutputBins];
  if (!session->analyzer.process(block.data(), block.size(), floorDb, ceilDb, spectrum)) {
    return -EIO;
  }

  int16_t pcm[kMaxAudioSamples];
  size_t pcmCount = 0;
  if (demodulate) {
    if (!session->demodulatorActive) {
      session->demodulator.reset();
      session->demodulatorActive = true;
    }
    pcmCount = session->demodulator.process(block.data(), block.size(), pcm, kMaxAudioSamples);
  } else {
    session->demodulatorActive = false;
  }

  env->SetFloatArrayRegion(bins, 0, azimuth::SpectrumAnalyzer::kOutputBins, spectrum);
  env->SetFloatArrayRegion(stats, 0, 2, adc);
  if (pcmCount > 0) {
    env->SetShortArrayRegion(audio, 0, static_cast<jsize>(pcmCount), pcm);
  }
  return static_cast<jint>(pcmCount);
}

}  // extern "C"
