// Smoke test del bridge AEC3 (gate de la Fase 0 del plan AUHAL/AEC3):
// genera un far-end de ruido determinístico, fabrica un "eco" (copia
// atenuada -6 dB y retardada 60 ms) como señal de mic, y verifica que tras
// converger el AEC lo atenúe > 20 dB. También verifica que el bypass sea un
// passthrough exacto.
//
// Compilación y ejecución: native/scripts/build-webrtc-apm.sh --smoke

#include "apm_bridge.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <random>
#include <vector>

namespace {

constexpr int kRate = 16000;
constexpr int kEchoDelaySamples = kRate * 60 / 1000; // 60 ms
constexpr float kEchoGain = 0.5f;                    // -6 dB
constexpr int kSeconds = 10;
constexpr int kTailSeconds = 2; // ventana de medición, post-convergencia

double energy(const int16_t* s, int n) {
  double e = 0;
  for (int i = 0; i < n; i++) e += double(s[i]) * s[i];
  return e;
}

} // namespace

int main() {
  ApmHandle* apm = apm_create(kRate);
  if (!apm) {
    fprintf(stderr, "FALLA: apm_create devolvió NULL\n");
    return 1;
  }
  const int frame = apm_frame_samples(apm);
  printf("APM creado: %d Hz, frame de %d samples (10 ms)\n", kRate, frame);

  // Far-end completo por adelantado: ruido blanco determinístico a -12 dBFS.
  std::mt19937 rng(42);
  std::uniform_int_distribution<int> dist(-8192, 8192);
  const int total = kRate * kSeconds;
  std::vector<int16_t> farend(total);
  for (auto& s : farend) s = int16_t(dist(rng));

  // Mic = eco puro: far-end retardado y atenuado (sin voz near-end).
  std::vector<int16_t> mic(total, 0);
  for (int i = kEchoDelaySamples; i < total; i++) {
    mic[i] = int16_t(farend[i - kEchoDelaySamples] * kEchoGain);
  }

  // Procesar en frames de 10 ms: render primero, capture después (el orden
  // real del pipeline: el sistema suena, el mic lo recoge).
  double echoInTail = 0, echoOutTail = 0;
  const int tailStart = total - kRate * kTailSeconds;
  std::vector<int16_t> work(frame);
  for (int off = 0; off + frame <= total; off += frame) {
    if (apm_process_render(apm, &farend[off]) != 0) {
      fprintf(stderr, "FALLA: process_render error en offset %d\n", off);
      return 1;
    }
    memcpy(work.data(), &mic[off], frame * sizeof(int16_t));
    if (apm_process_capture(apm, work.data()) != 0) {
      fprintf(stderr, "FALLA: process_capture error en offset %d\n", off);
      return 1;
    }
    if (off >= tailStart) {
      echoInTail += energy(&mic[off], frame);
      echoOutTail += energy(work.data(), frame);
    }
  }

  const double attenuationDb =
      10.0 * log10(echoInTail / (echoOutTail > 0 ? echoOutTail : 1e-9));
  printf("eco a la entrada (últimos %ds): %.3g | a la salida: %.3g\n",
         kTailSeconds, echoInTail, echoOutTail);
  printf("atenuación del eco: %.1f dB (gate: > 20 dB)\n", attenuationDb);

  // Bypass: passthrough exacto.
  apm_set_bypass(apm, 1);
  std::vector<int16_t> probe(frame);
  for (int i = 0; i < frame; i++) probe[i] = int16_t(i * 37 % 4096 - 2048);
  std::vector<int16_t> copy = probe;
  apm_process_capture(apm, probe.data());
  const bool bypassOk = memcmp(probe.data(), copy.data(), frame * 2) == 0;
  printf("bypass passthrough: %s\n", bypassOk ? "OK" : "FALLA");

  apm_destroy(apm);

  if (attenuationDb > 20.0 && bypassOk) {
    printf("✅ SMOKE TEST PASA\n");
    return 0;
  }
  printf("❌ SMOKE TEST FALLA\n");
  return 1;
}
