#!/bin/bash
# Compila el helper de audio: Swift (main.swift) + bridge C++ del APM de
# WebRTC (apm_bridge.cpp) + libs estáticas de webrtc-audio-processing.
# Reemplaza al swiftc directo desde la Fase B del plan AUHAL/AEC3
# (docs/plan-auhal-aec3.md): el helper ahora linkea AEC3.
#
# Si las libs del APM no están compiladas, corre build-webrtc-apm.sh
# (una sola vez; requiere meson/ninja — brew install meson ninja).
set -euo pipefail

NATIVE="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$NATIVE/vendor/webrtc-audio-processing"
BUILD="$NATIVE/build"
mkdir -p "$BUILD" "$NATIVE/bin"

# macOS MÍNIMO del producto: 14.4 (Sonoma) — el Core Audio process tap
# (AudioHardwareCreateProcessTap) que usa el canal de sistema existe recién
# ahí. Sin -target explícito, swiftc marca el binario con la versión del
# host (p.ej. 15.x) y NI SIQUIERA cargaría en un 14.4. Granola cubre <14.4
# con un fallback de ScreenCaptureKit — para nosotros es backlog, no v1.
ARCH="$(uname -m)"
MACOS_MIN="14.4"

if [ ! -f "$VENDOR/dist-universal/lib/libwebrtc-audio-processing-2.a" ]; then
  echo "== Libs del APM ausentes: compilando webrtc-audio-processing (una sola vez) =="
  "$NATIVE/scripts/build-webrtc-apm.sh"
fi

ABSL_INC=("$VENDOR"/subprojects/abseil-cpp-*)

# El bridge se recompila solo si cambió (es rápido igual, pero gratis).
if [ ! -f "$BUILD/apm_bridge.o" ] \
   || [ "$NATIVE/audio-helper/apm_bridge.cpp" -nt "$BUILD/apm_bridge.o" ] \
   || [ "$NATIVE/audio-helper/apm_bridge.h" -nt "$BUILD/apm_bridge.o" ]; then
  echo "== Compilando apm_bridge.cpp =="
  # El include del árbol FUENTE (además del instalado) da acceso al header
  # interno del aec3 (echo_canceller3.h) para inyectar config custom — los
  # símbolos ya están compilados en la lib estática.
  clang++ -std=c++17 -O2 -c "$NATIVE/audio-helper/apm_bridge.cpp" \
    -mmacosx-version-min="$MACOS_MIN" \
    -DNDEBUG -DWEBRTC_APM_DEBUG_DUMP=0 -DWEBRTC_MAC -DWEBRTC_POSIX \
    -I "$VENDOR/dist-arm64/include/webrtc-audio-processing-2" \
    -I "$VENDOR/webrtc" \
    -I "${ABSL_INC[0]}" \
    -o "$BUILD/apm_bridge.o"
fi

# -import-objc-header expone la API C del bridge a Swift.
swiftc -O "$NATIVE/audio-helper/main.swift" "$BUILD/apm_bridge.o" \
  -target "$ARCH-apple-macos$MACOS_MIN" \
  -import-objc-header "$NATIVE/audio-helper/apm_bridge.h" \
  "$VENDOR/dist-universal/lib/libwebrtc-audio-processing-2.a" \
  "$VENDOR"/dist-universal/lib/libabsl_*.a \
  -lc++ \
  -o "$NATIVE/bin/uyari-audio-helper"

echo "helper listo: $NATIVE/bin/uyari-audio-helper"
