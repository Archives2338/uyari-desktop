// Bridge C plano sobre el AudioProcessing (APM) de WebRTC — la pieza que
// permite llamar AEC3 desde Swift (Swift no habla C++; este header es C puro).
//
// Modelo de uso (ver docs/plan-auhal-aec3.md):
//   - Un handle por sesión de captura, a UNA sample rate (16 kHz para Uyari).
//   - El APM procesa frames de 10 ms EXACTOS (160 samples a 16 kHz, mono
//     int16). apm_frame_samples() devuelve el tamaño para no hardcodearlo.
//   - Por cada frame del tap de sistema (lo que suena por los parlantes):
//     apm_process_render() — es la señal de REFERENCIA (far-end).
//   - Por cada frame del mic: apm_process_capture() — IN-PLACE, deja el frame
//     con el eco restado. AEC3 estima el delay far/near solo (no alinear a
//     mano con timestamps).
//   - Con auriculares no hay eco físico: apm_set_bypass(1) hace que
//     process_capture sea un passthrough (el render se sigue aceptando y se
//     descarta barato).
//
// Hilos: process_render y process_capture pueden llamarse desde hilos
// distintos (el APM se sincroniza internamente), pero cada una desde UN solo
// hilo a la vez. create/destroy desde donde sea, nunca concurrente con las
// de proceso.

#ifndef UYARI_APM_BRIDGE_H
#define UYARI_APM_BRIDGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ApmHandle ApmHandle;

// Crea el APM con AEC3 habilitado (+ high-pass filter; sin NS/AGC — se
// evalúan después, ver plan). Render y capture pueden ir a rates DISTINTAS
// (el APM resamplea internamente): se procesa a la rate NATIVA de cada
// dispositivo, ANTES de nuestro downsample a 16 kHz — el downsampler lineal
// sin anti-aliasing pliega el espectro (aliasing) de forma diferente en la
// referencia digital y en el eco acústico, y eso el filtro lineal del AEC
// no lo puede modelar. Devuelve NULL si alguna rate no es soportada
// (soportadas: 8/16/32/48 kHz).
ApmHandle* apm_create(int render_rate_hz, int capture_rate_hz);

// Samples por frame de 10 ms de cada stream (480 a 48 kHz, 160 a 16 kHz).
int apm_render_frame_samples(const ApmHandle* h);
int apm_capture_frame_samples(const ApmHandle* h);

// Far-end: un frame de 10 ms del audio del sistema (mono int16).
// Devuelve 0 si ok, código de error del APM si no.
int apm_process_render(ApmHandle* h, const int16_t* frame);

// Near-end: un frame de 10 ms del mic, procesado IN-PLACE (mono int16).
// Devuelve 0 si ok, código de error del APM si no.
int apm_process_capture(ApmHandle* h, int16_t* frame);

// bypass != 0 → process_capture es passthrough (modo auriculares).
void apm_set_bypass(ApmHandle* h, int bypass);

void apm_destroy(ApmHandle* h);

#ifdef __cplusplus
}
#endif

#endif // UYARI_APM_BRIDGE_H
