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

namespace {

// Tuning agresivo para TRANSCRIPCIÓN (no para llamada full-duplex): el costo
// de dejar pasar eco (el STT transcribe la voz remota en el canal del
// usuario) es mayor que el de sobre-suprimir un poco en double-talk.
// Partimos de los defaults y endurecemos tres cosas:
//  - normal_tuning: suprimir con ratios de eco más chicos (masks más bajas).
//  - nearend_tuning: el modo "near-end dominante" del default es casi
//    transparente (enr_transparent=1.09) — es POR donde se fugaba el eco en
//    double-talk. Se baja a un punto protector pero no transparente.
//  - dominant_nearend_detection: más difícil ENTRAR y quedarse en ese modo.
webrtc::EchoCanceller3Config aggressiveEc3Config() {
  webrtc::EchoCanceller3Config cfg; // defaults de fábrica
  // El supresor subestima el eco residual con parlantes no lineales (los
  // armónicos de la distorsión no entran al modelo lineal → ENR chico →
  // masks transparentes; medido: bajar masks "razonables" no muerde, solo
  // valores casi-cero). ep_strength.default_gain infla la estimación del
  // camino del eco — el supresor ve el eco a su tamaño real.
  auto& s = cfg.suppressor;
  // Geometría de bandas (suppression_gain.cc): mask_lf gobierna <~750 Hz;
  // mask_hf gobierna el resto — INCLUIDA la zona de inteligibilidad del
  // habla (1-4 kHz). Tunear solo lf no mueve la aguja (medido).
  // normal (el usuario no domina): agresivo — sin costo para su voz.
  s.normal_tuning.mask_lf =
      webrtc::EchoCanceller3Config::Suppressor::MaskingThresholds(.2f, .3f, .3f);
  s.normal_tuning.mask_hf =
      webrtc::EchoCanceller3Config::Suppressor::MaskingThresholds(.05f, .08f, .3f);
  // nearend (double-talk): protector pero NO transparente como el default
  // (lf 1.09 = por ahí se fugaba el eco durante el habla del usuario).
  // nearend_tuning y dominant_nearend_detection quedan en STOCK: el modo
  // near-end dominante existe justamente para proteger la voz del usuario en
  // double-talk. La 6ª QA demostró que endurecerlo lo silencia ("solo se ve
  // cuando se pausa el audio"). El eco que se fugue por esta transparencia
  // lo caza el dedup TEXTUAL (native.engine.ts) — determinístico.
  return cfg;
}

class TunedEc3Factory : public webrtc::EchoControlFactory {
 public:
  std::unique_ptr<webrtc::EchoControl> Create(int sample_rate_hz,
                                              int num_render_channels,
                                              int num_capture_channels) override {
    return std::make_unique<webrtc::EchoCanceller3>(
        aggressiveEc3Config(), std::nullopt, sample_rate_hz,
        static_cast<size_t>(num_render_channels),
        static_cast<size_t>(num_capture_channels));
  }
};

} // namespace

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

  webrtc::AudioProcessingBuilder builder;
  // UYARI_AEC_TUNING=default deja el EC3 de fábrica (para A/B); si no, se
  // inyecta el tuning agresivo de transcripción.
  const char* tuning = std::getenv("UYARI_AEC_TUNING");
  if (!(tuning && std::string_view(tuning) == "default")) {
    builder.SetEchoControlFactory(std::make_unique<TunedEc3Factory>());
  }
  auto apm = builder.Create();
  if (!apm) return nullptr;

  webrtc::AudioProcessing::Config config;
  // Solo AEC en la primera iteración (plan Fase B): cada procesador extra
  // (NS/AGC) es una variable más al tunear. El high-pass es barato y ayuda
  // al AEC (quita DC/rumble que ensucia el filtro adaptativo).
  config.echo_canceller.enabled = true;
  config.echo_canceller.mobile_mode = false; // AEC3 completo, no AECM
  config.high_pass_filter.enabled = true;
  config.gain_controller1.enabled = false;
  // AGC (gain_controller2, control digital adaptativo): Granola lo pasa como
  // `enableAutomaticGainCompensation` al módulo nativo (confirmado en su
  // audio_process desminificado). Normaliza el nivel del mic DESPUÉS del AEC,
  // lo que ayuda a que el residuo de eco quede parejo/predecible y a que la
  // voz del usuario no varíe. Desactivable con UYARI_AGC=off para A/B.
  const char* agc = std::getenv("UYARI_AGC");
  const bool agcOn = !(agc && std::string_view(agc) == "off");
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
