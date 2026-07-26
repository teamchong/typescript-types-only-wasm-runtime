#!/bin/sh
# zig ships its own wasm-ld, which the homebrew llvm formula does not
set -e
zig cc \
  pong-tiny.c \
  -target wasm32-freestanding \
  -nostdlib -Os -Wall \
  -Wl,--import-memory \
  -Wl,--no-entry \
  -Wl,-z,stack-size=8192 \
  -o pong-tiny.wasm
wasm2wat pong-tiny.wasm --inline-exports --inline-imports --generate-names --fold-expr --output pong-tiny.wat
