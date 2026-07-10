#!/bin/bash
# Compila webrtc-audio-processing (el módulo APM de WebRTC con AEC3) como
# librería estática universal (arm64 + x86_64) para el helper de audio.
# Fase 0 del plan AUHAL/AEC3 — ver docs/plan-auhal-aec3.md.
#
# Requisitos: meson + ninja (brew install meson ninja), Xcode CLT.
# Uso:
#   native/scripts/build-webrtc-apm.sh            # clona + compila todo
#   native/scripts/build-webrtc-apm.sh --smoke    # además corre el smoke test
#
# Salidas (todo bajo native/vendor/, que está en .gitignore):
#   vendor/webrtc-audio-processing/dist-arm64/    lib + headers arm64
#   vendor/webrtc-audio-processing/dist-x86_64/   lib x86_64
#   vendor/webrtc-audio-processing/dist-universal/lib/*.a   lipo de ambas
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$NATIVE_DIR/vendor"
SRC_DIR="$VENDOR_DIR/webrtc-audio-processing"
REPO_GITLAB="https://gitlab.freedesktop.org/pulseaudio/webrtc-audio-processing.git"
REPO_GITHUB="https://github.com/pulseaudio/webrtc-audio-processing.git"

export PATH="/opt/homebrew/bin:$PATH"
# Mismo mínimo que el helper (ver build-helper.sh): sin esto las libs quedan
# marcadas con la versión del host y el link a 14.4 escupe warnings.
export MACOSX_DEPLOYMENT_TARGET="14.4"
command -v meson >/dev/null || { echo "meson no encontrado: brew install meson ninja"; exit 1; }
command -v ninja >/dev/null || { echo "ninja no encontrado: brew install meson ninja"; exit 1; }

# --- 1. Fuente -------------------------------------------------------------
if [ ! -d "$SRC_DIR" ]; then
  mkdir -p "$VENDOR_DIR"
  echo "== Clonando webrtc-audio-processing =="
  git clone --depth 1 "$REPO_GITLAB" "$SRC_DIR" \
    || git clone --depth 1 "$REPO_GITHUB" "$SRC_DIR"
fi
cd "$SRC_DIR"

# --- 2. Build por arquitectura ----------------------------------------------
build_arch() {
  local arch="$1" builddir="build-$1" distdir="$SRC_DIR/dist-$1"
  if [ -f "$distdir/lib/libwebrtc-audio-processing-2.a" ]; then
    echo "== $arch ya compilada (borrar dist-$arch para forzar) =="
    return
  fi
  echo "== Configurando $arch =="
  if [ "$arch" = "$(uname -m)" ]; then
    meson setup "$builddir" --buildtype=release --default-library=static \
      --prefix="$distdir"
  else
    # Cross-compile (x86_64 desde arm64 o viceversa) vía -arch de clang.
    local cross="$SRC_DIR/cross-$arch.ini"
    cat > "$cross" <<EOF
[binaries]
c = 'clang'
cpp = 'clang++'
objc = 'clang'
objcpp = 'clang++'
ar = 'ar'
strip = 'strip'

[built-in options]
c_args = ['-arch', '$arch']
cpp_args = ['-arch', '$arch']
objc_args = ['-arch', '$arch']
objcpp_args = ['-arch', '$arch']
c_link_args = ['-arch', '$arch']
cpp_link_args = ['-arch', '$arch']

[host_machine]
system = 'darwin'
cpu_family = '$arch'
cpu = '$arch'
endian = 'little'
EOF
    meson setup "$builddir" --buildtype=release --default-library=static \
      --prefix="$distdir" --cross-file "$cross"
  fi
  echo "== Compilando $arch =="
  ninja -C "$builddir"
  ninja -C "$builddir" install >/dev/null
}

build_arch arm64
build_arch x86_64

# --- 3. Universal (lipo de la lib principal + las de abseil) ----------------
UNI="$SRC_DIR/dist-universal/lib"
mkdir -p "$UNI"
lipo -create \
  "$SRC_DIR/dist-arm64/lib/libwebrtc-audio-processing-2.a" \
  "$SRC_DIR/dist-x86_64/lib/libwebrtc-audio-processing-2.a" \
  -output "$UNI/libwebrtc-audio-processing-2.a"
for a in "$SRC_DIR"/build-arm64/subprojects/abseil-cpp-*/libabsl_*.a; do
  name="$(basename "$a")"
  x86="$(echo "$SRC_DIR"/build-x86_64/subprojects/abseil-cpp-*/)$name"
  lipo -create "$a" "$x86" -output "$UNI/$name"
done
echo "== Universal listo =="
lipo -info "$UNI/libwebrtc-audio-processing-2.a"

# --- 4. Smoke test (opcional) ------------------------------------------------
if [ "${1:-}" = "--smoke" ]; then
  echo "== Compilando y corriendo smoke test =="
  mkdir -p "$NATIVE_DIR/bin"
  clang++ -std=c++17 -O2 \
    "$NATIVE_DIR/audio-helper/apm_bridge.cpp" \
    "$NATIVE_DIR/audio-helper/apm_smoke.cpp" \
    -I "$SRC_DIR/dist-arm64/include/webrtc-audio-processing-2" \
    -I "$SRC_DIR"/subprojects/abseil-cpp-* \
    "$UNI/libwebrtc-audio-processing-2.a" \
    "$UNI"/libabsl_*.a \
    -framework Foundation \
    -o "$NATIVE_DIR/bin/apm-smoke"
  "$NATIVE_DIR/bin/apm-smoke"
fi
