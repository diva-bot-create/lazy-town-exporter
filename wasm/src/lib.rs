//! The package builder (Peptide's fra_pack) for the browser. FrayTools runs a publish plugin in a page, and a page's
//! main thread may not block, which a thread pool does; so the plugin runs this in a worker,
//! which starts the pool's threads as more workers sharing this module's memory.
//!
//! The order of a start: the worker calls `pool_new(n)`, which builds rayon's pool and hands
//! back the queue its threads wait in; it starts `n` workers, each calling `pool_run(queue)`
//! and staying there as one of the pool's threads; then `pack` runs on the pool.

use rayon::ThreadBuilder;
use serde_json::Value;
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Mutex, OnceLock};
use wasm_bindgen::prelude::*;

static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();

/// the threads the pool is waiting to have started, one per worker
pub struct Queue(Mutex<Receiver<ThreadBuilder>>);

/// Build the pool of `threads` threads. Returns the queue each worker takes its thread from.
#[wasm_bindgen]
pub fn pool_new(threads: usize) -> Result<u32, JsValue> {
    let (tx, rx) = channel::<ThreadBuilder>();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads.max(1))
        .spawn_handler(move |t| tx.send(t).map_err(|e| std::io::Error::other(e.to_string())))
        .build()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    POOL.set(pool).map_err(|_| JsValue::from_str("the pool is already built"))?;
    Ok(Box::into_raw(Box::new(Queue(Mutex::new(rx)))) as u32)
}

/// the module's memory, which every thread's worker is started on
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue { wasm_bindgen::memory() }

/// Run one of the pool's threads on this worker. Does not return while the pool lives.
#[wasm_bindgen]
pub fn pool_run(queue: u32) {
    // SAFETY: `queue` is the pointer `pool_new` leaked; it lives as long as the module
    let q = unsafe { &*(queue as *const Queue) };
    let t = q.0.lock().unwrap().recv().unwrap();
    t.run();
}

/// Build the package. `library` is the JSON the plugin made of what FrayTools handed it, with
/// every file's bytes replaced by an index into `blobs`. The JS values become Rust data here,
/// on the calling worker; only that goes to the pool's threads. `header` and `png_max` are the
/// project's settings: the JSON compression type (`raw`, `base64`, `prettify`) and PNG compression.
#[wasm_bindgen]
pub fn pack(library: &str, blobs: js_sys::Array, header: &str, png_max: bool) -> Result<Vec<u8>, JsValue> {
    let t0 = js_sys::Date::now();
    let lib = read(library, &blobs).map_err(|e| JsValue::from_str(&format!("{e:#}")))?;
    let read_ms = js_sys::Date::now() - t0;
    let run = || fra_pack::build_timed(&lib, fra_pack::Options { parallel_json: false, header: fra_pack::HeaderText::named(header), png_max }, &js_sys::Date::now).map_err(|e| format!("{e:#}"));
    let (built, steps) = match POOL.get() { Some(p) => p.install(run), None => run() }.map_err(|e| JsValue::from_str(&e))?;
    let mut t = format!("read {read_ms}");
    for (n, ms) in steps { t.push_str(&format!(", {n} {ms}")); }
    *TIMES.lock().unwrap() = t;
    *WARNINGS.lock().unwrap() = built.warnings.join("\n");
    Ok(built.bytes)
}

static TIMES: Mutex<String> = Mutex::new(String::new());
static WARNINGS: Mutex<String> = Mutex::new(String::new());

/// what the last `pack` packed anyway (a missing picture drawn as the editor's placeholder), a line each
#[wasm_bindgen]
pub fn last_warnings() -> String { WARNINGS.lock().unwrap().clone() }

/// how long each step of the last `pack` took, in milliseconds
#[wasm_bindgen]
pub fn last_times() -> String { TIMES.lock().unwrap().clone() }

fn read(library: &str, blobs: &js_sys::Array) -> anyhow::Result<fra_pack::Library> {
    let v: Value = serde_json::from_str(library)?;
    let blob = |i: &Value| -> anyhow::Result<Vec<u8>> {
        let i = i.as_u64().ok_or_else(|| anyhow::anyhow!("a file names no bytes"))? as u32;
        Ok(js_sys::Uint8Array::new(&blobs.get(i)).to_vec())
    };
    let list = |k: &str| v[k].as_array().cloned().unwrap_or_default();
    let mut lib = fra_pack::Library {
        entities: list("entities"),
        manifest: v["manifest"].clone(),
        manifest_meta: v["manifestMeta"].clone(),
        ..Default::default()
    };
    for i in list("images") {
        lib.images.insert(i["guid"].as_str().unwrap_or("").to_string(), blob(&i["blob"])?);
    }
    for s in list("scripts") {
        lib.scripts.push(fra_pack::Script { meta: s["meta"].clone(), text: s["text"].as_str().unwrap_or("").to_string() });
    }
    for p in list("palettes") {
        lib.palettes.push((p["palette"].clone(), p["meta"].clone()));
    }
    for a in list("audio") {
        lib.audio.push(fra_pack::Audio { meta: a["meta"].clone(), format: a["format"].as_str().unwrap_or("wav").to_string(), bytes: blob(&a["blob"])? });
    }
    Ok(lib)
}
