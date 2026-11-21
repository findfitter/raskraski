// Холст: отрисовка, зум/сдвиг двумя пальцами, тапы по областям, номера, подсветка подсказки.
// Слои: fillCanvas (цвета областей, белый фон) + контуры исходной картинки через multiply.

import { PaintLayer } from './paintlayer.js';

const SLOP = 12;
const BRUSH_SLOP = 5;      // px: после такого сдвига одним пальцем начинается мазок           // px: сдвиг пальца, после которого это уже не тап
const TAP_MAX_MS = 700;
const DBL_MS = 350;
const DBL_DIST = 40;
const MIN_LABEL_PX = 9;    // номера мельче этого на экране не рисуем (появятся при зуме)

export class Viewer {
  constructor(canvas, host, cb) {
    this.cv = canvas;
    this.host = host;
    this.cb = cb || {};
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.pic = null;
    this.mode = 'free';
    this.s = 1; this.tx = 0; this.ty = 0; this.fit = 1;
    this.vw = 0; this.vh = 0; this.dpr = 1;
    this.pointers = new Map();
    this.tap = null; this.multi = false; this.pinch = null; this.lastTap = null;
    this.overlay = null; this._ovCache = null; this._raf = 0; this._anim = null;
    this.tool = 'fill';       // 'fill' — тап заливает область, 'brush' — рисуем кистью
    this.live = null;         // текущий мазок
    this._bind();
    new ResizeObserver(() => this.resize()).observe(host);
  }

  // ---------- загрузка ----------
  load(pic, session) {
    this.pic = pic;                // {w,h,lineCanvas,regions}
    this.session = session;
    this.cur = session.cur;        // Int32Array цветов подложки областей
    this.live = null;
    this.paint = new PaintLayer(pic.w, pic.h, pic.regions);
    const { w, h } = pic;
    this.fillCanvas = document.createElement('canvas');
    this.fillCanvas.width = w; this.fillCanvas.height = h;
    this.fctx = this.fillCanvas.getContext('2d', { willReadFrequently: true });
    const R = pic.regions;
    this.fs = new Float32Array(R.count + 1);
    this.num = new Uint8Array(R.count + 1);
    for (let r = 1; r <= R.count; r++) {
      const n = R.color[r];
      const digits = n >= 10 ? 2 : 1;
      this.num[r] = n;
      this.fs[r] = Math.min(44, digits === 1 ? 1.8 * R.lr[r] : 1.37 * R.lr[r]);
    }
    this._ovCache = null; this.overlay = null;
    this.refreshAll();
    this.resize(true);
  }

  /** Перерисовать слой заливки целиком по текущим цветам (при загрузке и очистке). */
  refreshAll() {
    const { w, h, regions } = this.pic;
    const map = regions.map;
    const id = this.fctx.createImageData(w, h);
    const d = id.data;
    const cur = this.cur;
    for (let p = 0, k = 0; p < map.length; p++, k += 4) {
      const r = map[p];
      const c = r ? cur[r] : -1;
      if (c >= 0) { d[k] = (c >> 16) & 255; d[k + 1] = (c >> 8) & 255; d[k + 2] = c & 255; }
      else { d[k] = d[k + 1] = d[k + 2] = 255; }
      d[k + 3] = 255;
    }
    this.fctx.putImageData(id, 0, 0);
    // слой краски (мазки и узоры эффектов) — по шагам каждой области
    this.paint.clear();
    for (let r = 1; r <= regions.count; r++) {
      const list = this.session.byRegion[r];
      if (list.length) this.paint.replayRegion(r, this.session.stepsOfRegion(r));
    }
    this.invalidate();
  }

  /** После отмены/повтора/заливки: слой цветов и слой краски области по данным сессии. */
  syncRegion(r) {
    this.paintRegion(r, this.cur[r]);
    this.paint.replayRegion(r, this.session.stepsOfRegion(r));
    this.invalidate();
  }

  /** Мгновенная заливка одной области по карте (только по рамке области). rgb = -1 → белый. */
  paintRegion(r, rgb) {
    const { w, regions } = this.pic;
    const b = r * 4;
    const x0 = regions.bbox[b], y0 = regions.bbox[b + 1];
    const bw = regions.bbox[b + 2] - x0 + 1, bh = regions.bbox[b + 3] - y0 + 1;
    if (bw <= 0 || bh <= 0) return;
    const img = this.fctx.getImageData(x0, y0, bw, bh);
    const d = img.data, map = regions.map;
    let R = 255, G = 255, B = 255;
    if (rgb >= 0) { R = (rgb >> 16) & 255; G = (rgb >> 8) & 255; B = rgb & 255; }
    for (let y = 0; y < bh; y++) {
      let p = (y0 + y) * w + x0;
      let k = y * bw * 4;
      for (let x = 0; x < bw; x++, p++, k += 4) {
        if (map[p] === r) { d[k] = R; d[k + 1] = G; d[k + 2] = B; }
      }
    }
    this.fctx.putImageData(img, x0, y0);
    this.invalidate();
  }

  setMode(mode) { this.mode = mode; this.invalidate(); }

  /** Миниатюра для плитки галереи. */
  makeThumb(maxW = 420) {
    const { w, h, lineCanvas } = this.pic;
    const k = Math.min(1, maxW / w);
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(this.fillCanvas, 0, 0, c.width, c.height);
    x.drawImage(this.paint.canvas, 0, 0, c.width, c.height);
    x.globalCompositeOperation = 'multiply';
    x.drawImage(lineCanvas, 0, 0, c.width, c.height);
    return c;
  }

  // ---------- размер и вид ----------
  resize(force) {
    const rect = this.host.getBoundingClientRect();
    const vw = Math.max(1, Math.round(rect.width)), vh = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!force && vw === this.vw && vh === this.vh && dpr === this.dpr) return;
    const wasFit = !this.pic || this.s <= this.fit * 1.001;
    this.vw = vw; this.vh = vh; this.dpr = dpr;
    this.cv.width = Math.round(vw * dpr);
    this.cv.height = Math.round(vh * dpr);
    if (this.pic) {
      const pad = 14;
      this.fit = Math.min((vw - pad * 2) / this.pic.w, (vh - pad * 2) / this.pic.h);
      if (wasFit) this.resetView(false);
      else { this.s = Math.max(this.s, this.fit); this._clamp(); }
    }
    this.invalidate();
  }

  resetView(animated = true) {
    if (!this.pic) return;
    const s = this.fit;
    const tx = (this.vw - this.pic.w * s) / 2, ty = (this.vh - this.pic.h * s) / 2;
    if (animated) this.animateTo(tx, ty, s);
    else { this._anim = null; this.s = s; this.tx = tx; this.ty = ty; this.invalidate(); }
  }

  zoomBy(f) { this.zoomAt(f, this.vw / 2, this.vh / 2); }

  zoomAt(f, px, py) {
    const ns = Math.min(this.fit * 8, Math.max(this.fit, this.s * f));
    const k = ns / this.s;
    this.tx = px - (px - this.tx) * k;
    this.ty = py - (py - this.ty) * k;
    this.s = ns;
    this._clamp();
    this.invalidate();
  }

  _clamp() {
    const iw = this.pic.w * this.s, ih = this.pic.h * this.s, m = 40;
    this.tx = iw <= this.vw ? (this.vw - iw) / 2 : Math.min(m, Math.max(this.vw - iw - m, this.tx));
    this.ty = ih <= this.vh ? (this.vh - ih) / 2 : Math.min(m, Math.max(this.vh - ih - m, this.ty));
  }

  animateTo(tx, ty, s) {
    this._anim = { t0: performance.now(), dur: 260, from: [this.tx, this.ty, this.s], to: [tx, ty, s] };
    this.invalidate();
  }

  /** Подвести вид к области: если её номер не виден или мелкий — центрируем и приближаем. */
  focusRegion(r) {
    const R = this.pic.regions;
    const lx = R.lx[r], ly = R.ly[r];
    const sx = lx * this.s + this.tx, sy = ly * this.s + this.ty;
    const inView = sx > 70 && sx < this.vw - 70 && sy > 70 && sy < this.vh - 70;
    const bw = R.bbox[r * 4 + 2] - R.bbox[r * 4] + 1, bh = R.bbox[r * 4 + 3] - R.bbox[r * 4 + 1] + 1;
    const want = Math.min(this.vw * 0.45 / bw, this.vh * 0.45 / bh);
    const readable = this.fs[r] * this.s >= 16;
    if (inView && readable) return;
    let s = Math.min(this.fit * 8, Math.max(this.fit, readable ? this.s : Math.max(this.s, Math.min(want, 16 / Math.max(this.fs[r], 1)))));
    const tx = this.vw / 2 - lx * s, ty = this.vh / 2 - ly * s;
    const iw = this.pic.w * s, ih = this.pic.h * s, m = 40;
    const ctx = iw <= this.vw ? (this.vw - iw) / 2 : Math.min(m, Math.max(this.vw - iw - m, tx));
    const cty = ih <= this.vh ? (this.vh - ih) / 2 : Math.min(m, Math.max(this.vh - ih - m, ty));
    this.animateTo(ctx, cty, s);
  }

  // ---------- подсветка ----------
  flash(r, kind) {
    const dur = kind === 'hint' ? 2600 : kind === 'ok' ? 350 : 500;
    this.overlay = { r, kind, t0: performance.now(), dur };
    this.invalidate();
  }

  _overlayCanvas(r, kind) {
    const c = this._ovCache;
    if (c && c.r === r && c.kind === kind) return c;
    const { w, regions } = this.pic;
    const b = r * 4;
    const x0 = regions.bbox[b], y0 = regions.bbox[b + 1];
    const bw = regions.bbox[b + 2] - x0 + 1, bh = regions.bbox[b + 3] - y0 + 1;
    const cv = document.createElement('canvas');
    cv.width = bw; cv.height = bh;
    const x = cv.getContext('2d');
    const id = x.createImageData(bw, bh);
    const d = id.data, map = regions.map;
    const col = kind === 'wrong' ? [229, 57, 53] : kind === 'ok' ? [255, 255, 255] : [255, 196, 0];
    for (let yy = 0; yy < bh; yy++) {
      let p = (y0 + yy) * w + x0;
      let k = yy * bw * 4;
      for (let xx = 0; xx < bw; xx++, p++, k += 4) {
        if (map[p] === r) { d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255; }
      }
    }
    x.putImageData(id, 0, 0);
    this._ovCache = { r, kind, cv, x0, y0 };
    return this._ovCache;
  }

  // ---------- отрисовка ----------
  invalidate() {
    if (this._raf) return;
    this._raf = requestAnimationFrame((t) => { this._raf = 0; this._draw(t); });
  }

  _draw() {
    if (!this.pic) return;
    const now = performance.now();
    let keep = false;
    if (this._anim) {
      const a = this._anim;
      const u = Math.min(1, (now - a.t0) / a.dur);
      const e = 1 - Math.pow(1 - u, 3);
      this.tx = a.from[0] + (a.to[0] - a.from[0]) * e;
      this.ty = a.from[1] + (a.to[1] - a.from[1]) * e;
      this.s = a.from[2] + (a.to[2] - a.from[2]) * e;
      if (u >= 1) this._anim = null; else keep = true;
    }
    const ctx = this.ctx, dpr = this.dpr, s = this.s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#cfd4dc';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.tx, dpr * this.ty);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(this.fillCanvas, 0, 0);
    ctx.drawImage(this.paint.canvas, 0, 0);
    if (this.live) ctx.drawImage(this.live.canvas, this.live.rect.x, this.live.rect.y);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.pic.lineCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    // подсветка (подсказка / ошибка)
    if (this.overlay) {
      const o = this.overlay;
      const age = now - o.t0;
      if (age >= o.dur) { this.overlay = null; }
      else {
        const oc = this._overlayCanvas(o.r, o.kind);
        let a;
        if (o.kind === 'hint') a = 0.38 + 0.3 * Math.sin(age / 130);
        else a = 0.7 * (1 - age / o.dur);
        ctx.globalAlpha = Math.max(0, a);
        ctx.drawImage(oc.cv, oc.x0, oc.y0);
        ctx.globalAlpha = 1;
        keep = true;
      }
    }

    // номера
    if (this.mode === 'num') this._drawLabels(ctx, s);

    if (keep) this.invalidate();
  }

  _drawLabels(ctx, s) {
    const R = this.pic.regions;
    const x0 = -this.tx / s - 40, y0 = -this.ty / s - 40;
    const x1 = (this.vw - this.tx) / s + 40, y1 = (this.vh - this.ty) / s + 40;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let r = 1; r <= R.count; r++) {
      if (this.cur[r] >= 0) continue;
      const fs = this.fs[r];
      if (fs * s < MIN_LABEL_PX) continue;
      const x = R.lx[r], y = R.ly[r];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      ctx.font = `800 ${fs}px "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.lineWidth = Math.max(fs * 0.22, 1.5 / s);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(this.num[r], x, y);
      ctx.fillStyle = '#16182b';
      ctx.fillText(this.num[r], x, y + fs * 0.04);
    }
  }

  // ---------- попадание ----------
  regionAt(clientX, clientY) {
    const rect = this.cv.getBoundingClientRect();
    const ix = Math.floor((clientX - rect.left - this.tx) / this.s);
    const iy = Math.floor((clientY - rect.top - this.ty) / this.s);
    const { w, h, regions } = this.pic;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return 0;
    return regions.map[iy * w + ix];
  }

  // ---------- жесты ----------
  _bind() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => this._down(e));
    cv.addEventListener('pointermove', (e) => this._move(e));
    cv.addEventListener('pointerup', (e) => this._up(e));
    cv.addEventListener('pointercancel', (e) => this._cancel(e));
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      if (!this.pic) return;
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
  }

  _pts() { return [...this.pointers.values()]; }

  _startPinch() {
    const [a, b] = this._pts();
    const rect = this.cv.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
    this.pinch = {
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s0: this.s,
      ix: (mx - this.tx) / this.s, iy: (my - this.ty) / this.s,
    };
    this._anim = null;
  }

  _imgPt(cx, cy) {
    const rect = this.cv.getBoundingClientRect();
    return [(cx - rect.left - this.tx) / this.s, (cy - rect.top - this.ty) / this.s];
  }

  _newStroke(cx, cy) {
    const [x, y] = this._imgPt(cx, cy);
    const ix = Math.floor(x), iy = Math.floor(y);
    const { w, h, regions } = this.pic;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return null;
    const r = regions.map[iy * w + ix];
    const b = this.cb.getBrush && this.cb.getBrush();
    if (!r || !b) return null;
    const live = this.paint.begin(r, b.z, b.e, b.c, (Math.random() * 2147483647) | 0);
    live.add(x, y);
    return live;
  }

  _strokeAdd(cx, cy) {
    const [x, y] = this._imgPt(cx, cy);
    this.live.add(x, y);
    this.invalidate();
  }

  _endStroke() {
    const live = this.live;
    this.live = null;
    live.commit();
    this.invalidate();
    if (this.cb.onStroke) this.cb.onStroke(live.step());
  }

  _cancelStroke() {
    if (this.live) { this.live = null; this.invalidate(); }
  }

  _down(e) {
    if (!this.pic) return;
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* синтетические события в тестах */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.multi = false;
      const pan = e.pointerType === 'mouse' && e.button !== 0; // правая/средняя кнопка мыши двигает картинку
      this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, pan };
    } else {
      // второй палец: это щипок; начатый мазок отменяется, тап — до отпускания всех пальцев
      this.multi = true;
      this.tap = null;
      this._cancelStroke();
      if (this.pointers.size === 2) this._startPinch();
    }
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = this._pts();
      const rect = this.cv.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ns = Math.min(this.fit * 8, Math.max(this.fit, this.pinch.s0 * d / this.pinch.d0));
      this.s = ns;
      this.tx = mx - this.pinch.ix * ns;
      this.ty = my - this.pinch.iy * ns;
      this._clamp();
      this.invalidate();
      return;
    }
    const t = this.tap;
    if (!t || t.id !== e.pointerId) return;
    const brush = this.tool === 'brush' && !t.pan;
    if (!t.moved && Math.hypot(e.clientX - t.x, e.clientY - t.y) > (brush ? BRUSH_SLOP : SLOP)) t.moved = true;
    if (!t.moved) return;
    if (brush) {
      if (!this.live) {
        if (t.noStroke) return;
        this.live = this._newStroke(t.x, t.y);
        if (!this.live) { t.noStroke = true; return; }
      }
      const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      if (evs.length) for (const ce of evs) this._strokeAdd(ce.clientX, ce.clientY);
      else this._strokeAdd(e.clientX, e.clientY);
    } else if (e.pointerType === 'mouse') {
      // мышью (для отладки на компьютере) можно двигать картинку одним нажатием; пальцем — только двумя
      this.tx += e.clientX - px; this.ty += e.clientY - py;
      this._clamp(); this.invalidate();
    }
  }

  _up(e) {
    const t = this.tap;
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) { this.multi = false; this.tap = null; }
    if (this.live && t && t.id === e.pointerId) { this._strokeAdd(e.clientX, e.clientY); this._endStroke(); return; }
    if (!t || t.id !== e.pointerId || !wasSingle || this.multi || t.moved || t.pan) return;
    const now = performance.now();
    if (now - t.t > TAP_MAX_MS) return;
    this._onTap(e.clientX, e.clientY, now);
  }

  _cancel(e) {
    this.pointers.delete(e.pointerId);
    this.tap = null;
    this._cancelStroke();
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.multi = false;
  }

  _onTap(x, y, now) {
    const l = this.lastTap;
    if (l && now - l.t < DBL_MS && Math.hypot(x - l.x, y - l.y) < DBL_DIST) {
      this.lastTap = null;
      if (this.cb.onDoubleTap) this.cb.onDoubleTap();
      this.resetView(true);       // двойное нажатие — сброс масштаба
      return;
    }
    this.lastTap = { t: now, x, y };
    if (this.tool === 'brush') {   // короткое касание кистью — точка
      this.live = this._newStroke(x, y);
      if (this.live) this._endStroke();
      return;
    }
    const r = this.regionAt(x, y);
    if (r && this.cb.onTap) this.cb.onTap(r);
  }
}
