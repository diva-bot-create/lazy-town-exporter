# Lazy Town Exporter

Publish in a blink.

Lazy Town Exporter replaces FrayTools' exporter with one that uses every core you've got. The
export step that used to eat up to half a minute now takes about a second, and your packages
come out smaller.

It puts on a show while it works: your content's own sprites, stock icon and stage art, in its
default costume, snapping together into a finished package.

## Install

1. Download `LazyTownExporter.zip` from the latest release and unzip it.
2. Drop the `LazyTownExporter` folder into your FrayTools plugins folder:
   - macOS: `~/FrayToolsData/plugins`
   - Windows: `%USERPROFILE%\FrayToolsData\plugins`
3. In **Plugins → Plugin Manager**, enable Lazy Town Exporter and switch off Fraymakers Content
   Exporter for your project.
4. Publish like you always do.

## Build

```
rustup toolchain install nightly --component rust-src --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129
./build.sh
```

The plugin lands in `build/LazyTownExporter`, zipped beside it.

To build against a local [Peptide](https://github.com/otsono/Peptide) checkout, put this in
`.cargo/config.toml`:

```
[patch."https://github.com/otsono/Peptide"]
fra_pack = { path = "../Peptide/crates/fra-pack" }
```

## Tech details

- The packer is Peptide's `fra_pack` crate, compiled to WebAssembly with threads and run on a
  pool of workers, one per core.
- Sheets are compressed in bands of rows in parallel, then joined into one PNG stream.
- Colours are rounded through premultiplied alpha the way FrayTools stores them.
- Output is the same bytes on any machine, at any thread count, and matches `peptide pack`.
- Kirby packs in about 0.3 s and Sky Pillars in about 1 s, where FrayTools' exporter takes 25 s
  and 8 s. Most of a publish is FrayTools gathering the project before any exporter runs, which
  no plugin can change.
- Built for FrayTools' Chrome 80 engine: shared memory without isolation, no SIMD, no reference
  types.
