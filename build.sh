#!/bin/sh
# build.sh -- the plugin, in build/LazyTownExporter: copy that folder into FrayTools' plugins
# folder and enable it in the Plugin Manager.
#
# needs: rustup's nightly with rust-src and the wasm32-unknown-unknown target (threads need std
# rebuilt with atomics), and wasm-bindgen-cli at the version wasm/Cargo.toml pins.
# the features are held to the ones FrayTools' browser engine has: `mvp` plus threads, bulk
# memory and the two small numeric ones, and no reference types or SIMD.
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)
OUT="$ROOT/build/LazyTownExporter"
# threads need the memory shared and handed in by the page, and each thread its own storage;
# the main stack is the packer worker's, each pool thread's is set where it starts (thread.js)
LINK="-C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=4294967296 -C link-arg=-zstack-size=8388608"
for sym in __wasm_init_tls __tls_size __tls_align __tls_base; do LINK="$LINK -C link-arg=--export=$sym"; done
RUSTFLAGS="-C target-cpu=mvp -C target-feature=+atomics,+bulk-memory,+mutable-globals,+sign-ext,+nontrapping-fptoint $LINK" \
  cargo +nightly build --manifest-path "$ROOT/wasm/Cargo.toml" --target wasm32-unknown-unknown --release \
  -Z build-std=panic_abort,std --target-dir "$ROOT/build/wasm"
rm -rf "$OUT" && mkdir -p "$OUT/pkg"
cp "$ROOT"/plugin/* "$OUT/"
wasm-bindgen --target no-modules --no-typescript --out-dir "$OUT/pkg" \
  "$ROOT/build/wasm/wasm32-unknown-unknown/release/lazy_town_exporter.wasm"
# the module rides in a script: a plugin page is a file, and a worker cannot fetch a file
{ printf 'self.LAZY_TOWN_EXPORTER_WASM = "'; base64 < "$OUT/pkg/lazy_town_exporter_bg.wasm" | tr -d '\n'; printf '";\n'; } \
  > "$OUT/pkg/lazy_town_exporter_wasm.js"
rm "$OUT/pkg/lazy_town_exporter_bg.wasm"
( cd "$ROOT/build" && rm -f LazyTownExporter.zip && zip -qr LazyTownExporter.zip LazyTownExporter )
echo "$OUT"
