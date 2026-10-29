// The plugin page. FrayTools loads it in a frame and talks to it by message: it hands the page
// the project's assets, and the page hands back the files to write. The packing runs in a
// worker (publisher.js starts it and its threads), because building it on threads means waiting,
// and a page may not. While it waits the page plays one of the animations in anims.js, picked
// at random each time it opens; a click on it skips the rest, and the project's settings can
// turn it off.
var UID = null;
var props = null;
var publisher = null;
var busy = false;
var shown = null;   // the animation on the stage, and when it started
var art = null;
var skip = null;    // the current publish's skip: settles when the stage is clicked

// the project's settings, kept by FrayTools with the project: the editor's own exporter's two
// (its JSON compression type and PNG compression) and whether the animation plays
function settings() {
  var c = props.configMetadata || {};
  return { header: c.jsonCompression || 'raw', pngMax: c.pngCompression === true, quiet: c.skipAnimation === true };
}
function saveSetting(key, value) {
  var c = {};
  for (var k in props.configMetadata) c[k] = props.configMetadata[k];
  c[key] = value;
  props.configMetadata = c;
  send('pluginConfigSyncRequest', { data: { configMetadata: c } });
}
function settingsForm(view) {
  var c = settings();
  var row = function (label, control) {
    var r = document.createElement('label');
    r.className = 'setting';
    var t = document.createElement('span');
    t.textContent = label;
    r.appendChild(t);
    r.appendChild(control);
    view.appendChild(r);
  };
  var select = function (options, value, onChange) {
    var el = document.createElement('select');
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0]; opt.textContent = o[1];
      el.appendChild(opt);
    });
    el.value = value;
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  };
  row('JSON compression type', select([['raw', 'Raw'], ['base64', 'Base64'], ['prettify', 'Prettify']], c.header,
    function (v) { saveSetting('jsonCompression', v); }));
  row('PNG compression', select([['false', 'Disabled (faster / larger file size)'], ['true', 'Enabled (slower / smaller file size)']],
    String(c.pngMax), function (v) { saveSetting('pngCompression', v === 'true'); }));
  var box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = c.quiet;
  box.addEventListener('change', function () { saveSetting('skipAnimation', box.checked); });
  row('Skip the publish animation', box);
}

function send(command, data) { parent.postMessage({ id: UID, command: command, data: data }, '*'); }
function log(level) { send('pluginLog', { level: level, args: [].slice.call(arguments, 1) }); }
function caption(text, kind) {
  var el = document.getElementById('caption');
  if (!el) return;
  el.textContent = text;
  el.className = 'caption' + (kind ? ' ' + kind : '');
}

// the bytes FrayTools holds for an asset, as a picture the page can show
function pictureOf(guid) {
  var a = guid && props.guidToAsset[guid];
  if (!a || !a.binaryData) return null;
  return URL.createObjectURL(new Blob([a.binaryData], { type: 'image/png' }));
}
// the first costume of the palette an entity names (or of the project's first palette), as a
// map from each source colour (0xRRGGBB) to the colour the game draws it in
function firstCostume(entity) {
  var want = entity && entity.paletteMap && entity.paletteMap.paletteCollection;
  var pal = props.paletteCollectionAssets.filter(function (p) { return p.guid === want; })[0] || props.paletteCollectionAssets[0];
  if (!pal || !pal.maps || !pal.maps.length) return null;
  var src = {}, map = {};
  (pal.colors || []).forEach(function (c) { src[c.$id] = parseInt(String(c.color).slice(-6), 16); });
  (pal.maps[0].colors || []).forEach(function (m) {
    if (src[m.paletteColorId] !== undefined) map[src[m.paletteColorId]] = parseInt(String(m.targetColor).slice(-6), 16);
  });
  return map;
}
// a picture in a costume's colours: every pixel whose colour the costume names is swapped, as
// the game does, and its alpha kept
function recoloured(url, costume) {
  if (!url || !costume) return Promise.resolve(url);
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      var g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      var d = g.getImageData(0, 0, cv.width, cv.height), px = d.data;
      for (var i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        var to = costume[(px[i] << 16) | (px[i + 1] << 8) | px[i + 2]];
        if (to !== undefined) { px[i] = to >> 16; px[i + 1] = (to >> 8) & 255; px[i + 2] = to & 255; }
      }
      g.putImageData(d, 0, 0);
      cv.toBlob(function (b) { resolve(b ? URL.createObjectURL(b) : url); });
    };
    img.onerror = function () { resolve(url); };
    img.src = url;
  });
}
// the IMAGE assets an entity's animation draws, in the order it draws them
function drawnBy(entity, animName) {
  var byId = function (k) { var m = {}; (entity[k] || []).forEach(function (x) { m[x.$id] = x; }); return m; };
  var layers = byId('layers'), keys = byId('keyframes'), syms = byId('symbols'), out = [];
  (entity.animations || []).forEach(function (a) {
    if (animName && a.name !== animName) return;
    (a.layers || []).forEach(function (lid) {
      var l = layers[lid];
      if (!l || l.type !== 'IMAGE') return;
      (l.keyframes || []).forEach(function (kid) {
        var s = keys[kid] && syms[keys[kid].symbol];
        if (s && s.imageAsset && out.indexOf(s.imageAsset) < 0) out.push(s.imageAsset);
      });
    });
  });
  return out;
}
// a picture of an entity's animation as its first frame draws it: every IMAGE layer at its
// place, scale and turn, the last layer underneath
function firstFrame(entity, animName, costume) {
  var byId = function (k) { var m = {}; (entity[k] || []).forEach(function (x) { m[x.$id] = x; }); return m; };
  var layers = byId('layers'), keys = byId('keyframes'), syms = byId('symbols');
  var anim = (entity.animations || []).filter(function (a) { return a.name === animName; })[0];
  if (!anim) return Promise.resolve(null);
  var parts = [];
  (anim.layers || []).slice().reverse().forEach(function (lid) {
    var l = layers[lid], k = l && l.type === 'IMAGE' && keys[(l.keyframes || [])[0]], sym = k && syms[k.symbol];
    if (sym && sym.imageAsset) parts.push(sym);
  });
  return Promise.all(parts.map(function (sym) {
    return recoloured(pictureOf(sym.imageAsset), costume).then(function (url) {
      return new Promise(function (resolve) {
        if (!url) return resolve(null);
        var img = new Image();
        img.onload = function () { resolve({ img: img, s: sym }); };
        img.onerror = function () { resolve(null); };
        img.src = url;
      });
    });
  })).then(function (drawn) {
    drawn = drawn.filter(Boolean);
    if (!drawn.length) return null;
    var place = function (d, g) {
      var s = d.s, px = s.pivotX || 0, py = s.pivotY || 0;
      g.translate((s.x || 0) + px, (s.y || 0) + py);
      g.rotate((s.rotation || 0) * Math.PI / 180);
      g.translate(-px, -py);
      g.scale(s.scaleX === undefined ? 1 : s.scaleX, s.scaleY === undefined ? 1 : s.scaleY);
    };
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    drawn.forEach(function (d) {
      var m = new DOMMatrix(); var g = { translate: function (x, y) { m = m.translate(x, y); }, rotate: function (r) { m = m.rotate(r * 180 / Math.PI); }, scale: function (a, b) { m = m.scale(a, b); } };
      place(d, g);
      [[0, 0], [d.img.width, 0], [0, d.img.height], [d.img.width, d.img.height]].forEach(function (c) {
        var p = m.transformPoint(new DOMPoint(c[0], c[1]));
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      });
    });
    var k = Math.min(1, 640 / Math.max(x1 - x0, y1 - y0, 1));
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round((x1 - x0) * k)); cv.height = Math.max(1, Math.round((y1 - y0) * k));
    var g = cv.getContext('2d');
    drawn.forEach(function (d) {
      g.save(); g.scale(k, k); g.translate(-x0, -y0);
      if (d.s.alpha !== undefined && d.s.alpha !== null) g.globalAlpha = d.s.alpha;
      place(d, g); g.drawImage(d.img, 0, 0); g.restore();
    });
    return { canvas: cv, url: cv.toDataURL('image/png') };
  });
}
// the largest picture an entity draws (by its file's size, which tracks how much is in it), as
// a canvas
function largestPicture(entity, costume) {
  var guids = entity ? drawnBy(entity) : [];
  var size = function (g) { var a = props.guidToAsset[g]; return a && a.binaryData ? a.binaryData.length : 0; };
  var best = guids.sort(function (a, b) { return size(b) - size(a); })[0];
  if (!best) return Promise.resolve(null);
  return recoloured(pictureOf(best), costume).then(function (url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        cv.getContext('2d').drawImage(img, 0, 0);
        resolve({ canvas: cv, url: url });
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  });
}
// a picture cut to a box of the given size, filling it (the middle of it kept), as an image url
function covering(canvas, w, h) {
  var cv = document.createElement('canvas');
  cv.width = w * 2; cv.height = h * 2;
  var k = Math.max(cv.width / canvas.width, cv.height / canvas.height);
  cv.getContext('2d').drawImage(canvas, (cv.width - canvas.width * k) / 2, (cv.height - canvas.height * k) / 2, canvas.width * k, canvas.height * k);
  return cv.toDataURL('image/png');
}

// the content's own art, found through what its manifest declares: the stock icon its menu
// entity draws and the frames its own entity draws, in its first costume. content that
// declares no stock icon (a stage) is shown by the picture its manifest renders it with, and
// content with few frames of its own shows pieces of that picture instead
function findArt() {
  var found = { icon: null, frames: [], picture: null, mosaic: null };
  var ready = Promise.resolve();
  try {
    var byId = {};
    props.spriteEntityAssets.forEach(function (e) { byId[e.id] = e; });
    var m = props.scriptAssets.filter(function (s) { return s.id === 'manifest'; })[0];
    var content = JSON.parse(m.script).content || [];
    var main = content.filter(function (c) { return c.metadata && c.metadata.ui; })[0];
    var ui = main ? main.metadata.ui : {};
    var menu = byId[ui.entityId];
    var own = main && byId[main.id] || menu || props.spriteEntityAssets.slice().sort(function (a, b) {
      return (b.symbols || []).length - (a.symbols || []).length;
    })[0];
    var costume = firstCostume(own);
    var stockAnim = ui.hud && ui.hud.animation_stock_icon;
    var stock = menu && stockAnim ? drawnBy(menu, stockAnim)[0] : null;
    var frames = own ? drawnBy(own).slice(0, 12) : [];
    var renderAnim = ui.render && (ui.render.animation_icon || ui.render.animation);
    ready = Promise.all([
      recoloured(pictureOf(stock), costume),
      Promise.all(frames.map(function (g) { return recoloured(pictureOf(g), costume); })),
      !stock || frames.length < 6 ? (menu ? firstFrame(menu, renderAnim, costume) : Promise.resolve(null)).then(function (pic) {
        // a render animation can be slots its scripts fill at run time, with nothing drawn yet;
        // then the content's picture is its largest one
        return pic || largestPicture(own, costume);
      }) : Promise.resolve(null)
    ]).then(function (all) {
      found.icon = all[0];
      found.frames = all[1].filter(Boolean);
      var pic = all[2];
      if (pic) {
        found.picture = pic.url;
        if (!found.icon) found.icon = pic.url;
        if (found.frames.length < 6) { found.frames = []; found.mosaic = { tiles: covering(pic.canvas, 240, 160), strip: pic.canvas }; }
      }
    });
  } catch (e) { log('warn', '[Lazy Town Exporter] no art for the animation: ' + e.message); }
  found.ready = ready.catch(function (e) { log('warn', '[Lazy Town Exporter] no art for the animation: ' + e.message); });
  return found;
}

function render() {
  var view = document.getElementById('view');
  view.innerHTML = '';
  if (props.configMode) {
    settingsForm(view);
    return;
  }
  if (settings().quiet) {
    var plain = document.createElement('div');
    plain.id = 'caption';
    plain.className = 'caption';
    view.appendChild(plain);
    caption(busy ? 'Publishing...' : 'Ready');
    return;
  }
  if (!art) art = findArt();
  var stage = document.createElement('div');
  stage.className = 'stage' + (busy ? '' : ' idle');
  stage.title = 'Click to skip';
  stage.addEventListener('click', function () { if (busy && skip) skip.now(); });
  view.appendChild(stage);
  var cap = document.createElement('div');
  cap.id = 'caption';
  cap.className = 'caption';
  view.appendChild(cap);
  caption(busy ? 'Publishing...' : 'Ready');
  var scaler = document.createElement('div');
  scaler.className = 'scaler';
  var scene = document.createElement('div');
  scene.className = 'scene';
  scaler.appendChild(scene);
  stage.appendChild(scaler);
  var fit = function () {
    var k = Math.min(stage.clientWidth / 400, stage.clientHeight / 260);
    scaler.style.transform = 'scale(' + k + ')';
  };
  fit();
  window.addEventListener('resize', fit);
  art.ready.then(function () {
    if (shown && shown.stage === stage) return;
    shown = { anim: Anims.pick((props.configMetadata || {}).animation)(scene, art), since: performance.now(), stage: stage };
  });
}

function library() {
  var blobs = [];
  var filename = function (guid) { var a = props.guidToAsset[guid]; return (a && a.filename) || ''; };
  var byFilename = function (a, b) { var fa = filename(a.guid), fb = filename(b.guid); return fa < fb ? -1 : fa > fb ? 1 : 0; };
  var withoutScript = function (asset) { var m = {}; for (var k in asset) if (k !== 'script') m[k] = asset[k]; return m; };
  var entities = props.spriteEntityAssets.slice().sort(byFilename);
  var drawn = {};
  entities.forEach(function (e) {
    (e.symbols || []).forEach(function (s) { if (s.type === 'IMAGE' && s.imageAsset) drawn[s.imageAsset] = true; });
  });
  var images = [];
  Object.keys(drawn).sort().forEach(function (guid) {
    var a = props.guidToAsset[guid];
    if (a && a.binaryData) { images.push({ guid: guid, blob: blobs.length }); blobs.push(a.binaryData); }
  });
  var manifest = null;
  var scripts = [];
  props.scriptAssets.slice().sort(byFilename).forEach(function (s) {
    if (s.id === 'manifest') manifest = s;
    else scripts.push({ meta: withoutScript(s), text: s.script || '' });
  });
  if (!manifest) throw new Error('the project has no manifest');
  var palettes = props.paletteCollectionAssets.slice().sort(byFilename)
    .map(function (p) { return { palette: p, meta: p }; });
  var audio = props.audioAssets.slice().sort(byFilename).map(function (a) {
    var name = filename(a.guid), dot = name.lastIndexOf('.');
    var bytes = (props.guidToAsset[a.guid] || {}).binaryData || new Uint8Array(0);
    blobs.push(bytes);
    return { meta: a, format: dot >= 0 ? name.substr(dot + 1) : 'wav', blob: blobs.length - 1 };
  });
  return {
    json: JSON.stringify({
      entities: entities, images: images, scripts: scripts, palettes: palettes, audio: audio,
      manifest: JSON.parse(manifest.script), manifestMeta: withoutScript(manifest)
    }),
    blobs: blobs,
    name: JSON.parse(manifest.script).resourceId
  };
}

// a finish never cuts the loop off in its first moments: a package made in a few hundred
// milliseconds still gets a beat of the loop before its finish
var LEAST_LOOP_MS = 600;
// FrayTools closes the dialog the moment it has the files, so the finish plays first and the
// result is held this long before they are handed over
var HOLD_RESULT_MS = 700;

// settles when the stage is clicked, or at once once it has been
function skipper() {
  var now = null;
  var p = new Promise(function (resolve) { now = resolve; });
  p.now = function () { p.done = true; now(); };
  return p;
}
function after(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function publish() {
  if (busy) return;
  busy = true;
  skip = skipper();
  var mine = skip;
  var conf = settings();
  send('publishStart');
  caption('Publishing...');
  var stage = document.querySelector('.stage');
  if (stage) stage.classList.remove('idle');
  if (shown) shown.since = performance.now();
  var t0 = performance.now();
  var lib;
  try { lib = library(); } catch (e) { return failed(e.message); }
  if (publisher && publisher.broken) publisher = null;
  if (!publisher) {
    if (typeof SharedArrayBuffer === 'undefined') return failed('this FrayTools does not give plugins shared memory, which the packer\'s threads need');
    publisher = new Publisher(navigator.hardwareConcurrency || 4);
  }
  publisher.pack(lib.json, lib.blobs, conf).then(function (r) {
    // FrayTools takes a file's bytes as a Uint8Array, whatever the field is called
    var bytes = new Uint8Array(r.bytes);
    var files = {};
    props.outputFolders.forEach(function (f) {
      files[f.id] = [{ filename: lib.name + '.fra', arrayBuffer: bytes }];
    });
    var ms = Math.round(performance.now() - t0);
    var text = lib.name + '.fra  ·  ' + (bytes.byteLength / 1048576).toFixed(1) + ' MB  ·  packed in ' +
      (r.packMs / 1000).toFixed(2) + ' s on ' + publisher.threads + ' threads';
    log('log', '[Lazy Town Exporter] published ' + text + ' (' + ms + ' ms in the plugin)');
    // what was packed anyway: each to FrayTools' log, and a count on the result
    var warned = r.warnings ? r.warnings.split('\n') : [];
    warned.forEach(function (w) { log('warn', '[Lazy Town Exporter] ' + w); });
    if (warned.length) text += '  ·  ' + warned.length + ' missing sprite' + (warned.length > 1 ? 's' : '') + ' drawn as placeholders';
    // no animation (the setting, or none on the stage) hands the files over at once; a click on
    // the stage cuts what is left of it, the loop, the finish and the hold alike
    var playing = shown && !conf.quiet;
    var wait = playing ? Math.max(0, LEAST_LOOP_MS - (performance.now() - shown.since)) : 0;
    var finished = after(wait).then(function () { return mine.done || !playing ? null : shown.anim.finish(); });
    Promise.race([finished, mine]).then(function () {
      caption(text, warned.length ? 'warn' : 'done');
      return Promise.race([after(playing ? HOLD_RESULT_MS : 0), mine]);
    }).then(function () {
      skip = null;
      busy = false;
      send('publishEnd', { files: files });
    });
  }, function (err) { failed(err.message); });
}

function failed(message) {
  busy = false;
  skip = null;
  caption(message, 'err');
  log('error', '[Lazy Town Exporter] ' + message);
  send('publishError', { message: message });
}

window.addEventListener('message', function (e) {
  var d = e.data || {};
  switch (d.command) {
    case 'loadPlugin':
      UID = d.data.uid;
      props = d.data.props;
      props.configMetadata = props.configMetadata || {};
      render();
      send('pluginReady');
      break;
    case 'pluginPropsReceived':
      props = d.data.props;
      if (props.configMode || !shown) render();
      break;
    case 'forcePublish':
      publish();
      break;
  }
});
