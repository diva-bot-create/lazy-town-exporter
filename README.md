# Lazy Town Exporter

Export in a blink.

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

## Settings

Open them from the plugin's settings in FrayTools. They're saved with the project.

- **JSON compression type** and **PNG compression**: the same two settings as Fraymakers Content
  Exporter, writing the package the way it would. PNG compression on packs the sheets a little
  smaller and takes a little longer.
- **Skip the publish animation**: publishes with just a caption. You can also click the animation
  during any publish to skip the rest of it.

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

- A fighter with 2,562 sprites packs in under a second. FrayTools' exporter takes about 25 s.
- A stage with 131 full-size backdrop images packs in about a second. FrayTools' exporter takes
  about 8 s.
- Before any exporter runs, FrayTools spends a few seconds (longer for big stages) gathering the
  project. That part is FrayTools' own and no plugin can speed it up.
- The packer is Peptide's `fra_pack` crate in Rust, compiled to WebAssembly with threads. A Web
  Worker runs it, and a pool of more workers, one per core, shares its memory through
  `SharedArrayBuffer` as a [rayon](https://github.com/rayon-rs/rayon) thread pool.
- Pictures decode and sprite sheets compress in parallel. Each sheet is split into bands of rows
  that deflate side by side and join back into one PNG stream, so even a single huge sheet uses
  every core.
- The JSON half of the work (entities, scripts, the package header) stays on one thread: in
  WebAssembly every thread shares one allocator lock, and millions of small allocations run
  slower spread out than in a row.
- Colours are rounded through premultiplied alpha the way FrayTools stores them, which is a big
  part of why see-through stage art packs so much smaller.
- Output is the same bytes on any machine and at any thread count, and matches `peptide pack`.
- Built for FrayTools' Chrome 80 engine: the WebAssembly MVP plus threads and bulk memory, with
  no SIMD or reference types. The module ships inside a script, since a plugin page is a local
  file and its workers can't fetch one.
