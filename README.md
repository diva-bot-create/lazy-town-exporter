# Lazy Town Exporter

A FrayTools publish plugin that builds Fraymakers content packages on every core. It writes the
same package FrayTools' own exporter does, in about a second where that takes 8 to 25 s.

While it publishes it plays one of three animations (sheet assembly, filmstrip, fight finish),
picked at random, drawn from the content's own art: a fighter's sprites and stock icon in its
first costume, a stage's background.

## install

1. Download `LazyTownExporter.zip` from the latest release and unzip it.
2. Move the `LazyTownExporter` folder into FrayTools' plugins folder:
   - macOS: `~/FrayToolsData/plugins`
   - Windows: `%USERPROFILE%\FrayToolsData\plugins`
3. In FrayTools, open **Plugins → Plugin Manager**, enable **Lazy Town Exporter**, and turn off
   **Fraymakers Content Exporter** for the project.
4. Publish as usual (**File → Publish Project → Publish All**).

## what it does differently

- pictures are decoded, sheets compressed and entities compiled on a pool of WebAssembly
  threads, one per core
- sheets are compressed in bands of rows side by side, which also makes them smaller than the
  built-in exporter's
- the package is the same bytes on any machine and any number of threads

FrayTools gathers the whole project before it hands it to any exporter, which takes most of a
publish (a few seconds for a fighter, longer for a big stage); no plugin can speed that part up.

## build

needs Rust nightly with `rust-src` and the `wasm32-unknown-unknown` target, and
`wasm-bindgen-cli` 0.2.129:

```
rustup toolchain install nightly --component rust-src --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129
./build.sh
```

the plugin lands in `build/LazyTownExporter` (and `build/LazyTownExporter.zip`).
`cargo test` runs the packer's own tests natively.

## layout

- `crates/fra-pack`: the package builder, from a project's library held in memory
- `wasm`: that builder for the browser, with its thread pool
- `plugin`: the plugin page FrayTools loads, its workers, and the animations
