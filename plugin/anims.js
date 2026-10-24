// The publish animations: sheet assembly, filmstrip and fight finish. Each one is mounted on a stage and loops while the package is made
// (no progress is shown: how long FrayTools takes to gather a project is not known), and plays
// its finish when the package is done. `art` is the fighter's own: its stock icon and a run of
// its sprite frames, found through what the project's manifest declares.
var Anims = (function () {
  function el(tag, css, parent, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function after(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function check(size, color) {
    var s = el('div', 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';', null);
    s.className = 'center';
    s.innerHTML = '<svg width="' + size * 0.55 + '" height="' + size * 0.55 + '" viewBox="0 0 24 24" fill="none" stroke="#1d2b1f" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    return s;
  }
  // the same transform an element is showing now, held, so a finish starts where the loop was
  function freeze(e) {
    var t = getComputedStyle(e).transform;
    e.style.animation = 'none';
    e.style.transform = t === 'none' ? '' : t;
  }
  function burst(stage, color, n, reach) {
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2, d = reach * (0.7 + Math.random() * 0.5);
      var p = el('div', 'position:absolute;width:7px;height:7px;border-radius:50%;background:' + color +
        ';--dx:' + Math.cos(a) * d + 'px;--dy:' + Math.sin(a) * d + 'px;animation:pk-drop .7s cubic-bezier(.15,.7,.3,1) forwards', stage);
      p.style.animationDelay = (Math.random() * 0.06) + 's';
    }
  }

  // A: sprite tiles pop in like a sheet being packed; they snap into one sheet that folds into the file
  function sheets(stage, art) {
    var grid = el('div', 'display:grid;grid-template-columns:repeat(6,40px);gap:8px;transition:gap .25s ease,transform .4s cubic-bezier(.6,0,.2,1),opacity .35s', stage);
    var tiles = [];
    var pieces = !art.frames.length && art.mosaic;
    for (var i = 0; i < 24; i++) {
      var f = art.frames.length ? art.frames[i % art.frames.length] : null;
      // with no frames of its own, each tile is a piece of the content's picture, which the
      // finish puts together by closing the gaps
      var bg = pieces ? 'url(' + art.mosaic.tiles + ') ' + (-(i % 6) * 40) + 'px ' + (-Math.floor(i / 6) * 40) + 'px/240px 160px no-repeat'
        : f ? 'url(' + f + ') center/contain no-repeat' : '';
      var t = el('div', 'width:40px;height:40px;border-radius:' + (pieces ? 3 : 7) + 'px;background:#33413f ' + bg +
        ';border:1px solid #3f5f5a;animation:pk-pop 1.5s ease-in-out infinite;animation-delay:' + ((i % 6 + Math.floor(i / 6)) * 0.08) + 's', grid);
      tiles.push(t);
    }
    var card = el('div', 'position:absolute;opacity:0;display:flex;flex-direction:column;align-items:center', stage);
    var file = el('div', 'position:relative;width:110px;height:132px;border-radius:14px;background:#2f3d33;border:3px solid var(--done)', card);
    file.className = 'center';
    file.appendChild(check(62, 'var(--done)'));
    return {
      finish: function () {
        tiles.forEach(function (t) { freeze(t); t.style.transition = 'transform .25s cubic-bezier(.3,1.3,.5,1),opacity .2s'; });
        requestAnimationFrame(function () {
          tiles.forEach(function (t) { t.style.transform = 'scale(1)'; t.style.opacity = 1; if (pieces) { t.style.borderRadius = '0'; t.style.borderColor = 'transparent'; } });
          grid.style.gap = '0px';
        });
        // the assembled picture holds a moment before it folds into the file
        return after(pieces ? 700 : 300).then(function () {
          grid.style.transform = 'scale(.25)'; grid.style.opacity = 0;
          return after(180);
        }).then(function () {
          el('div', 'position:absolute;width:130px;height:130px;border-radius:50%;border:3px solid var(--done);animation:pk-ring .8s ease-out forwards', stage);
          card.style.animation = 'pk-in .55s cubic-bezier(.3,1.35,.5,1) forwards';
          burst(stage, 'var(--done)', 14, 130);
          return after(600);
        });
      }
    };
  }

  // C: the fighter's frames roll past on a strip; it brakes, one frame lifts and a stamp lands
  function film(stage, art) {
    var frames = art.frames.length ? art.frames : [null, null, null, null, null, null, null];
    var pan = !art.frames.length && art.mosaic;
    if (pan) frames = [0, 1, 2, 3, 4, 5, 6, 7];
    var strip = el('div', 'position:absolute;left:0;top:50%;margin-top:-44px;display:flex;width:max-content;animation:pk-slide ' + (frames.length * 0.32) + 's linear infinite', stage);
    var cells = [];
    // panning: the picture at the strip's height, each frame a window further along it
    var panW = pan ? Math.max(66, art.mosaic.strip.width * 88 / art.mosaic.strip.height) : 0;
    var panUrl = pan ? art.mosaic.strip.toDataURL('image/png') : null;
    for (var r = 0; r < 2; r++) frames.forEach(function (f, i) {
      var bg = pan ? 'url(' + panUrl + ') ' + (-(panW - 66) * i / 7) + 'px 0/' + panW + 'px 88px no-repeat'
        : f ? 'url(' + f + ') center/80% no-repeat' : '';
      var c = el('div', 'flex:none;margin-right:10px;width:66px;height:88px;border-radius:8px;background:#303030 ' + bg +
        ';border:1px solid #474747;transition:transform .5s cubic-bezier(.3,1.4,.5,1),opacity .35s', strip, f || pan ? '' : String(i + 1));
      cells.push(c);
    });
    var stamp = el('div', 'position:absolute;opacity:0;padding:6px 18px;border:3px solid var(--done);border-radius:8px;color:var(--done);background:rgba(35,35,35,.85);font:600 26px/1.2 -apple-system,sans-serif;letter-spacing:.5px', stage, 'Published');
    return {
      finish: function () {
        freeze(strip);
        var box = stage.getBoundingClientRect(), mid = box.left + box.width / 2, best = null, bd = 1e9;
        cells.forEach(function (c) { var b = c.getBoundingClientRect(), d = Math.abs(b.left + b.width / 2 - mid); if (d < bd) { bd = d; best = c; } });
        cells.forEach(function (c) { if (c !== best) { c.style.opacity = 0.35; c.style.transform = 'scale(.88)'; } });
        if (best) { best.style.transform = 'translateY(-14px) scale(1.4)'; best.style.borderColor = 'var(--done)'; best.style.zIndex = 2; }
        return after(320).then(function () {
          stamp.style.zIndex = 3;
          stamp.style.animation = 'pk-stamp .45s cubic-bezier(.2,1.25,.4,1) forwards';
          return after(500);
        });
      }
    };
  }

  // F: a fight game's "Ready?" pulses over speed lines; the finish slams in with a shake
  function fight(stage, art) {
    var lines = el('div', 'position:absolute;left:0;top:0;bottom:0;width:200%;animation:pk-speed .5s linear infinite;' +
      'background:repeating-linear-gradient(90deg,transparent 0 46px,rgba(255,255,255,.06) 46px 48px,transparent 48px 90px,rgba(95,212,196,.12) 90px 93px);transition:opacity .2s', stage);
    var ready = el('div', 'position:absolute;font:italic 800 40px/1 -apple-system,sans-serif;color:var(--ink);letter-spacing:1px;animation:pk-pulse .9s ease-in-out infinite', stage, 'READY?');
    // a stock icon sits beside the word; a wider picture (a stage's) above it
    var wide = art.picture && art.icon === art.picture;
    var slam = el('div', 'position:absolute;opacity:0;display:flex;align-items:center' + (wide ? ';flex-direction:column' : ''), stage);
    if (art.icon) el('div', (wide ? 'margin-bottom:12px;width:150px;height:84px;border-radius:8px;background:url(' + art.icon + ') center/cover no-repeat'
      : 'margin-right:14px;width:56px;height:56px;background:url(' + art.icon + ') center/contain no-repeat;image-rendering:pixelated'), slam);
    el('div', 'font:italic 900 44px/1 -apple-system,sans-serif;color:var(--hot);letter-spacing:1px;-webkit-text-stroke:2px #5a3a00', slam, 'PUBLISHED!');
    var flash = el('div', 'position:absolute;top:0;left:0;right:0;bottom:0;background:#fff;opacity:0', stage);
    return {
      finish: function () {
        freeze(ready);
        ready.style.transition = 'transform .15s ease-in,opacity .15s';
        ready.style.transform = 'scale(.4)'; ready.style.opacity = 0;
        lines.style.opacity = 0;
        return after(150).then(function () {
          flash.style.animation = 'pk-glow .25s ease-out forwards';
          slam.style.animation = 'pk-slam .42s cubic-bezier(.2,1.2,.4,1) forwards';
          return after(230);
        }).then(function () {
          stage.style.animation = 'pk-shake .2s linear 2';
          burst(stage, 'var(--hot)', 14, 160);
          return after(550);
        });
      }
    };
  }

  // one is picked each time the plugin opens; the fight finish comes up half the time
  var weights = [['fight', 2], ['sheets', 1], ['film', 1]];
  var make = { sheets: sheets, film: film, fight: fight };
  return {
    // `name` (sheets, film or fight) forces one, for recording it; otherwise it is random
    pick: function (name) {
      if (make[name]) return make[name];
      var total = weights.reduce(function (t, w) { return t + w[1]; }, 0), r = Math.random() * total;
      for (var i = 0; i < weights.length; i++) { r -= weights[i][1]; if (r < 0) return make[weights[i][0]]; }
      return make.fight;
    }
  };
})();
