// Слой «краски»: мазки кистью и узоры эффектов. Лежит над слоем плоских заливок и под контурами.
// Каждый мазок/узор ограничен областью, в которой он начат, поэтому за линии краска не выходит.
import { mulberry32, css, mix, patternFor, isPatternEffect, SPARKLE, drawSparkle, heart, star5 } from './effects.js';

const KEY = { 2: 'rainbow', 5: 'gold', 6: 'silver', 7: 'pearl' };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function regionRect(regions, r) {
  const b = r * 4;
  const x = regions.bbox[b], y = regions.bbox[b + 1];
  return { x, y, w: regions.bbox[b + 2] - x + 1, h: regions.bbox[b + 3] - y + 1 };
}
function intersect(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
/** Маска области (с заходом под линии) в рамке rect: непрозрачные пиксели = область. */
function buildMask(regions, W, r, rect) {
  const c = mk(rect.w, rect.h);
  const x = c.getContext('2d');
  const id = x.createImageData(rect.w, rect.h);
  const d = id.data, map = regions.map;
  for (let yy = 0; yy < rect.h; yy++) {
    let p = (rect.y + yy) * W + rect.x, k = yy * rect.w * 4;
    for (let xx = 0; xx < rect.w; xx++, p++, k += 4) if (map[p] === r) d[k + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}

/** Мазок, который рисуется «вживую» в собственном слое (с маской области) и затем вклеивается в слой краски. */
export class LiveStroke {
  constructor(pl, { r, z, e, c, s }, rect) {
    this.pl = pl; this.r = r; this.z = z; this.e = e; this.c = c; this.seed = s; this.rect = rect;
    this.canvas = mk(rect.w, rect.h);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.translate(-rect.x, -rect.y);
    this.mask = buildMask(pl.regions, pl.w, r, rect);
    this.rnd = mulberry32(s);
    this.pts = []; this.last = null; this.dist = 0; this.nextStamp = 0;
    this.hue0 = s % 360;
    this.pattern = isPatternEffect(e) && e !== 2 ? patternFor(this.ctx, KEY[e]) : null;
    this.spacing = Math.max(z * 0.95, 14);
  }

  _style() {
    const e = this.e;
    if (e === 0 || e === 1) return css(this.c);
    if (e === 2) return `hsl(${(this.hue0 + this.dist * 1.5) % 360} 92% 56%)`;
    return this.pattern; // золото/серебро/перламутр; у сердечек и звёзд подложки нет
  }

  add(x, y) {
    const qx = Math.round(x * 4), qy = Math.round(y * 4);
    const px = qx / 4, py = qy / 4;
    const l = this.last;
    if (!l) {
      this.pts.push(qx, qy);
      this._dot(px, py);
    } else {
      if (Math.hypot(px - l.x, py - l.y) < 1.2) return false;
      this.pts.push(qx, qy);
      this._seg(l.x, l.y, px, py);
    }
    this.last = { x: px, y: py };
    return true;
  }

  _stamp(x, y) {
    const { ctx, rnd, z, e, c } = this;
    ctx.fillStyle = rnd() < 0.5 ? css(c) : css(mix(c, 0xffffff, 0.35));
    const k = 0.85 + rnd() * 0.3, rot = (rnd() - 0.5) * 0.9;
    if (e === 3) heart(ctx, x, y, Math.max(z * 0.34, 4.5) * k, rot);
    else star5(ctx, x, y, Math.max(z * 0.55, 7) * k, rot);
  }

  _sparkles(count, place) {
    const { ctx, rnd, z, e, c } = this;
    const size = clamp(z / 14, 0.9, 2.2);
    for (let i = 0; i < count; i++) { const [x, y] = place(); drawSparkle(ctx, rnd, x, y, e, c, size); }
  }

  _count(expected) { const n = Math.floor(expected); return n + (this.rnd() < expected - n ? 1 : 0); }

  _dot(x, y) {
    const { ctx, z, e } = this;
    const st = this._style();
    if (st) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = st;
      ctx.beginPath(); ctx.arc(x, y, z / 2, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (e === 3 || e === 4) { this._stamp(x, y); this.nextStamp = this.spacing; }
    const sp = SPARKLE[e];
    if (sp) {
      const rr = z / 2;
      this._sparkles(this._count(Math.PI * rr * rr * sp.stroke), () => {
        const a = this.rnd() * 6.2832, d = Math.sqrt(this.rnd()) * rr;
        return [x + Math.cos(a) * d, y + Math.sin(a) * d];
      });
    }
    this._finishRect(x - z, y - z, x + z, y + z);
  }

  _seg(ax, ay, bx, by) {
    const { ctx, z, e } = this;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    const st = this._style();
    if (st) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.strokeStyle = st; ctx.lineWidth = z; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    const D0 = this.dist;
    this.dist += len;
    if (e === 3 || e === 4) {
      while (this.nextStamp <= this.dist) {
        const t = (this.nextStamp - D0) / len;
        this._stamp(ax + dx * t, ay + dy * t);
        this.nextStamp += this.spacing * (0.85 + this.rnd() * 0.3);
      }
    }
    const sp = SPARKLE[e];
    if (sp) {
      const nx = -dy / len, ny = dx / len;
      this._sparkles(this._count(len * z * sp.stroke), () => {
        const u = this.rnd(), v = (this.rnd() - 0.5) * z;
        return [ax + dx * u + nx * v, ay + dy * u + ny * v];
      });
    }
    const m = z * 0.5 + 6;
    this._finishRect(Math.min(ax, bx) - m - z * 0.6, Math.min(ay, by) - m - z * 0.6, Math.max(ax, bx) + m + z * 0.6, Math.max(ay, by) + m + z * 0.6);
  }

  /** Применяем маску области к только что нарисованному участку слоя. */
  _finishRect(x0, y0, x1, y1) {
    const R = this.rect;
    const sx = clamp(Math.floor(x0 - R.x), 0, R.w), sy = clamp(Math.floor(y0 - R.y), 0, R.h);
    const ex = clamp(Math.ceil(x1 - R.x), 0, R.w), ey = clamp(Math.ceil(y1 - R.y), 0, R.h);
    if (ex <= sx || ey <= sy) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // destination-in стирает всё вне нарисованного прямоугольника, поэтому ограничиваем его клипом
    ctx.beginPath(); ctx.rect(sx, sy, ex - sx, ey - sy); ctx.clip();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.mask, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
    ctx.restore();
  }

  commit() { this.pl.ctx.drawImage(this.canvas, this.rect.x, this.rect.y); }

  step() { return { k: 's', r: this.r, c: this.c, e: this.e, z: this.z, s: this.seed, p: this.pts }; }
}

export class PaintLayer {
  constructor(w, h, regions) {
    this.w = w; this.h = h; this.regions = regions;
    this.canvas = mk(w, h);
    this.ctx = this.canvas.getContext('2d');
    this.live = null;
  }

  clear() { this.ctx.clearRect(0, 0, this.w, this.h); }

  clearRegion(r) {
    const rect = regionRect(this.regions, r);
    const m = buildMask(this.regions, this.w, r, rect);
    const c = this.ctx;
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(m, rect.x, rect.y);
    c.globalCompositeOperation = 'source-over';
  }

  /** Начать мазок «вживую». */
  begin(r, z, e, c, seed) {
    this.live = new LiveStroke(this, { r, z, e, c, s: seed }, regionRect(this.regions, r));
    return this.live;
  }

  _replayStroke(st) {
    const p = st.p;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i] / 4); x1 = Math.max(x1, p[i] / 4);
      y0 = Math.min(y0, p[i + 1] / 4); y1 = Math.max(y1, p[i + 1] / 4);
    }
    const m = st.z + 20;
    const rect = intersect(regionRect(this.regions, st.r), { x: Math.floor(x0 - m), y: Math.floor(y0 - m), w: Math.ceil(x1 - x0 + 2 * m), h: Math.ceil(y1 - y0 + 2 * m) });
    const ls = new LiveStroke(this, st, rect);
    for (let i = 0; i < p.length; i += 2) ls.add(p[i] / 4, p[i + 1] / 4);
    ls.commit();
  }

  /** Узор эффекта на всю область (слой краски в области уже очищен). */
  _applyFill(st) {
    const { r, e, c, s } = st;
    if (!e) return;
    const rect = regionRect(this.regions, r);
    const cv = mk(rect.w, rect.h);
    const ctx = cv.getContext('2d');
    ctx.translate(-rect.x, -rect.y);
    const rnd = mulberry32(s);
    if (isPatternEffect(e)) {
      ctx.fillStyle = patternFor(ctx, KEY[e]);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    const sp = SPARKLE[e];
    if (sp) {
      const n = Math.min(14000, Math.round(rect.w * rect.h * sp.fill));
      for (let i = 0; i < n; i++) drawSparkle(ctx, rnd, rect.x + rnd() * rect.w, rect.y + rnd() * rect.h, e, c, 1.1);
    }
    if (e === 3 || e === 4) {
      const g = 36;
      let row = 0;
      for (let gy = rect.y; gy < rect.y + rect.h + g; gy += g, row++) {
        for (let gx = rect.x - (row % 2) * (g / 2); gx < rect.x + rect.w + g; gx += g) {
          const x = gx + (rnd() - 0.5) * g * 0.35, y = gy + (rnd() - 0.5) * g * 0.35;
          ctx.fillStyle = rnd() < 0.5 ? css(c) : css(mix(c, 0xffffff, 0.35));
          const k = 0.85 + rnd() * 0.3, rot = (rnd() - 0.5) * 0.9;
          if (e === 3) heart(ctx, x, y, 10 * k, rot); else star5(ctx, x, y, 14 * k, rot);
        }
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(buildMask(this.regions, this.w, r, rect), 0, 0);
    ctx.restore();
    this.ctx.drawImage(cv, rect.x, rect.y);
  }

  /** Перерисовать краску одной области по её шагам (начиная с последней заливки). */
  replayRegion(r, steps) {
    this.clearRegion(r);
    for (const st of steps) {
      if (st.k === 'f') this._applyFill(st);
      else this._replayStroke(st);
    }
  }
}
