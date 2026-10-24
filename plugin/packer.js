// The worker that builds the package: it loads the packer and builds its thread pool, hands the
// page what the threads need, and packs when asked. The packer blocks while its threads work,
// which a worker may do and a page may not.
importScripts('pkg/lazy_town_exporter.js', 'pkg/lazy_town_exporter_wasm.js');

function bytesOf(base64) {
  var s = atob(base64), out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

onmessage = function (e) {
  var d = e.data;
  if (d.start) {
    WebAssembly.compile(bytesOf(self.LAZY_TOWN_EXPORTER_WASM)).then(function (module) {
      return wasm_bindgen({ module_or_path: module }).then(function () {
        var queue = wasm_bindgen.pool_new(d.start);
        postMessage({ pool: true, module: module, memory: wasm_bindgen.wasm_memory(), queue: queue });
      });
    }).catch(function (err) { postMessage({ error: String(err && err.message || err) }); });
    return;
  }
  try {
    var t0 = performance.now();
    var bytes = wasm_bindgen.pack(d.library, d.blobs);
    var buf = bytes.buffer;
    postMessage({ bytes: buf, packMs: Math.round(performance.now() - t0), times: wasm_bindgen.last_times(), warnings: wasm_bindgen.last_warnings() }, [buf]);
  } catch (err) {
    postMessage({ error: String(err && err.message || err) });
  }
};
