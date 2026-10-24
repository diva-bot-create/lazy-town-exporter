// Starts the packer and its threads, and builds packages with them. Every worker is started
// here, by the page: a worker started from inside another worker is not something every engine
// FrayTools may run on allows. The packer worker loads the module and builds the pool, the page
// hands its module and memory to each thread worker, and packing starts once all are up.
function Publisher(threads) {
  var packer = new Worker('packer.js');
  var waiting = null;
  var ready = new Promise(function (resolve, reject) {
    waiting = { resolve: resolve, reject: reject };
  });
  var job = null;
  var workers = [packer];
  var self = this;
  // a worker that stops mid-pack leaves the rest waiting on it for good, so the pack fails and
  // every worker goes; the next publish starts over
  function stopped(message) {
    var w = waiting || job;
    waiting = job = null;
    self.broken = true;
    workers.forEach(function (x) { x.terminate(); });
    if (w) w.reject(new Error(message));
  }
  packer.onerror = function (e) { stopped(e.message || 'the packer stopped'); };
  packer.onmessage = function (e) {
    var d = e.data;
    // a failed pack may have left the module's memory half-built, so it is not reused either
    if (d.error) { stopped(d.error); return; }
    if (d.pool) {
      var up = [];
      for (var i = 0; i < threads; i++) {
        up.push(new Promise(function (resolve, reject) {
          var t = new Worker('thread.js'), started = false;
          workers.push(t);
          t.onmessage = function (m) {
            if (m.data && m.data.error) { if (started) stopped(m.data.error); else reject(new Error(m.data.error)); return; }
            started = true; resolve();
          };
          t.onerror = function (err) {
            if (started) stopped(err.message || 'a packer thread stopped'); else reject(new Error(err.message || 'a packer thread did not start'));
          };
          t.postMessage({ module: d.module, memory: d.memory, queue: d.queue });
        }));
      }
      Promise.all(up).then(function () { var w = waiting; waiting = null; w.resolve(); }, function (err) { stopped(err.message); });
      return;
    }
    if (d.bytes) { var j = job; job = null; j.resolve(d); }
  };
  packer.postMessage({ start: threads });
  this.threads = threads;
  // the package's bytes, from the library JSON and the files' bytes it points into
  this.pack = function (library, blobs) {
    return ready.then(function () {
      return new Promise(function (resolve, reject) {
        job = { resolve: resolve, reject: reject };
        packer.postMessage({ library: library, blobs: blobs });
      });
    });
  };
}
