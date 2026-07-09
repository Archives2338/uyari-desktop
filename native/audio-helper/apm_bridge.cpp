// Implementación del bridge C sobre webrtc-audio-processing v2 (AEC3).
// Ver apm_bridge.h para el contrato y docs/plan-auhal-aec3.md para el plan.

#include "apm_bridge.h"

#include <atomic>

#include <modules/audio_processing/include/audio_processing.h>

struct ApmHandle {
  rtc::scoped_refptr<webrtc::AudioProcessing> apm;
  webrtc::StreamConfig config;
  std::atomic<bool> bypass{false};
};

extern "C" {

ApmHandle* apm_create(int sample_rate_hz) {
  // El APM trabaja nativamente a 8/16/32/48 kHz. Uyari usa 16 kHz (lo que
  // consume el STT); otras rates son error de programación, no un caso a
  // adaptar en silencio.
  if (sample_rate_hz != 8000 && sample_rate_hz != 16000 &&
      sample_rate_hz != 32000 && sample_rate_hz != 48000) {
    return nullptr;
  }

  auto apm = webrtc::AudioProcessingBuilder().Create();
  if (!apm) return nullptr;

  webrtc::AudioProcessing::Config config;
  // Solo AEC en la primera iteración (plan Fase B): cada procesador extra
  // (NS/AGC) es una variable más al tunear. El high-pass es barato y ayuda
  // al AEC (quita DC/rumble que ensucia el filtro adaptativo).
  config.echo_canceller.enabled = true;
  config.echo_canceller.mobile_mode = false; // AEC3 completo, no AECM
  config.high_pass_filter.enabled = true;
  config.gain_controller1.enabled = false;
  config.gain_controller2.enabled = false;
  config.noise_suppression.enabled = false;
  apm->ApplyConfig(config);

  auto* h = new ApmHandle();
  h->apm = std::move(apm);
  h->config = webrtc::StreamConfig(sample_rate_hz, 1);
  return h;
}

int apm_frame_samples(const ApmHandle* h) {
  return static_cast<int>(h->config.num_frames());
}

int apm_process_render(ApmHandle* h, const int16_t* frame) {
  if (h->bypass.load(std::memory_order_relaxed)) return 0;
  // La API exige un destino; el render no se modifica de forma útil para
  // nosotros, así que se escribe a un scratch local (no thread-shared: esta
  // función se llama desde un solo hilo, ver header).
  static thread_local int16_t scratch[480]; // 10 ms a 48 kHz, la rate máxima
  return h->apm->ProcessReverseStream(frame, h->config, h->config, scratch);
}

int apm_process_capture(ApmHandle* h, int16_t* frame) {
  if (h->bypass.load(std::memory_order_relaxed)) return 0;
  // In-place: src == dest está soportado por el APM.
  return h->apm->ProcessStream(frame, h->config, h->config, frame);
}

void apm_set_bypass(ApmHandle* h, int bypass) {
  h->bypass.store(bypass != 0, std::memory_order_relaxed);
}

void apm_destroy(ApmHandle* h) {
  delete h; // scoped_refptr libera el APM
}

} // extern "C"
