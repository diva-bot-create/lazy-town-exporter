// One of the packer's threads: the packer's module on the packer's memory, then the pool's loop.
importScripts('pkg/lazy_town_exporter.js');

onmessage = function (e) {
  var d = e.data;
  try {
    // decoding and compressing a large sheet goes deep; 8 MB of stack where the default is 1
    wasm_bindgen.initSync({ module: d.module, memory: d.memory, thread_stack_size: 8 << 20 });
  } catch (err) {
    postMessage({ error: String(err && err.stack || err) });
    return;
  }
  postMessage({ up: true });
  wasm_bindgen.pool_run(d.queue);
};
