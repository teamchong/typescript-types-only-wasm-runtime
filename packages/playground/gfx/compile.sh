#!/bin/sh
# zig ships its own wasm-ld, which the homebrew llvm formula does not
set -e
zig cc \
  gfx.c \
  -target wasm32-freestanding \
  -nostdlib -Os -Wall \
  -Wl,--import-memory \
  -Wl,--no-entry \
  -Wl,-z,stack-size=8192 \
  -o gfx.wasm
wasm2wat gfx.wasm --inline-exports --inline-imports --generate-names --fold-expr --output gfx.wat
