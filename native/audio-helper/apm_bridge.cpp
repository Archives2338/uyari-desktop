// Implementación del bridge C sobre webrtc-audio-processing v2 (AEC3).
// Ver apm_bridge.h para el contrato y docs/plan-auhal-aec3.md para el plan.

#include "apm_bridge.h"

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <optional>
#include <string_view>

#include <modules/audio_processing/include/audio_processing.h>
// Header interno del aec3 (no se instala, se incluye del árbol fuente; los
// símbolos SÍ están en la lib estática): lo necesitamos para inyectar un
// EchoCanceller3Config propio — el default del APM es demasiado conservador
// para transcripción (deja pasar residuo que el STT transcribe, sobre todo
// en double-talk). Granola hace exactamente esto: construye su
// EchoCanceller3Config explícito (confirmado en su binario).
#include <modules/audio_processing/aec3/echo_canceller3.h>

// NOTA (RE del binario de Granola, os/granola-desktop.md §3.4): Granola usa
// el EchoCanceller3Config DE FÁBRICA, sin un solo override — su constructor
// default va directo al factory sin tocar ningún campo. Nuestro tuning
// agresivo del suppressor (masks bajas) fue la dirección EQUIVOCADA: dañaba
// el near-end (half-duplex) sin arreglar el eco de parlante saturado. Su
// ventaja está UPSTREAM del AEC3 (delay externo + render/capture alineados a
// rate nativa). Por eso acá NO tuneamos el EC3 — el APM usa su AEC3 stock.

struct ApmHandle {
  rtc::scoped_refptr<webrtc::AudioProcessing> apm;
  webrtc::StreamConfig renderConfig;
  webrtc::StreamConfig captureConfig;
  std::atomic<bool> bypass{false};
  std::atomic<int> delayMs{0};
};

namespace {
bool supportedRate(int hz) {
  return hz == 8000 || hz == 16000 || hz == 32000 || hz == 48000;
}
} // namespace

extern "C" {

ApmHandle* apm_create(int render_rate_hz, int capture_rate_hz) {
  // El APM (interfaz int16) trabaja nativamente a 8/16/32/48 kHz. Otras
  // rates son responsabilidad del caller (caer a la ruta de 16 kHz).
  if (!supportedRate(render_rate_hz) || !supportedRate(capture_rate_hz)) {
    return nullptr;
  }

  // AEC3 STOCK (sin factory custom): idéntico a Granola. La separación limpia
  // viene de la alineación upstream, no del tuning del EC3.
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
  // AGC (gain_controller2 adaptativo): Granola lo usa, pero para NUESTRO caso
  // (fuga de eco) PERJUDICA — aplica ganancia DESPUÉS del AEC y amplifica el
  // eco residual hacia el rango que el STT transcribe (medido: con alineación
  // por timestamp la cancelación da 23.8 dB sin AGC vs 11 dB aparentes con
  // AGC, que era artefacto de la amplificación). OFF por defecto; UYARI_AGC=on
  // para experimentar. Granola puede permitírselo porque su AEC deja residuo
  // negligible; el nuestro todavía no.
  const char* agc = std::getenv("UYARI_AGC");
  const bool agcOn = agc && std::string_view(agc) == "on";
  config.gain_controller2.enabled = agcOn;
  config.gain_controller2.adaptive_digital.enabled = agcOn;
  config.noise_suppression.enabled = false;
  apm->ApplyConfig(config);

  auto* h = new ApmHandle();
  h->apm = std::move(apm);
  h->renderConfig = webrtc::StreamConfig(render_rate_hz, 1);
  h->captureConfig = webrtc::StreamConfig(capture_rate_hz, 1);
  return h;
}

int apm_render_frame_samples(const ApmHandle* h) {
  return static_cast<int>(h->renderConfig.num_frames());
}

int apm_capture_frame_samples(const ApmHandle* h) {
  return static_cast<int>(h->captureConfig.num_frames());
}

int apm_process_render(ApmHandle* h, const int16_t* frame) {
  if (h->bypass.load(std::memory_order_relaxed)) return 0;
  // La API exige un destino; el render no se modifica de forma útil para
  // nosotros, así que se escribe a un scratch local (no thread-shared: esta
  // función se llama desde un solo hilo, ver header).
  static thread_local int16_t scratch[480]; // 10 ms a 48 kHz, la rate máxima
  return h->apm->ProcessReverseStream(frame, h->renderConfig, h->renderConfig,
                                      scratch);
}

int apm_process_capture(ApmHandle* h, int16_t* frame) {
  if (h->bypass.load(std::memory_order_relaxed)) return 0;
  // El APM exige el delay por-frame (se resetea tras cada ProcessStream).
  h->apm->set_stream_delay_ms(h->delayMs.load(std::memory_order_relaxed));
  // In-place: src == dest está soportado por el APM.
  return h->apm->ProcessStream(frame, h->captureConfig, h->captureConfig,
                               frame);
}

void apm_set_bypass(ApmHandle* h, int bypass) {
  h->bypass.store(bypass != 0, std::memory_order_relaxed);
}

void apm_set_stream_delay_ms(ApmHandle* h, int delay_ms) {
  // El APM acota internamente a [0, 500]; clampear aquí evita el warning.
  if (delay_ms < 0) delay_ms = 0;
  if (delay_ms > 500) delay_ms = 500;
  h->delayMs.store(delay_ms, std::memory_order_relaxed);
}

void apm_destroy(ApmHandle* h) {
  delete h; // scoped_refptr libera el APM
}

} // extern "C"
