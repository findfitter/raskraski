// Анимированные «волшебные» краски. На слое краски лежит их статичный вид (подложка),
// а поверх него каждый кадр рисуется живой узор, обрезанный по форме (маске) краски:
//   8  Мерцающие блёстки   — искры загораются и гаснут
//   9  Радужный перелив    — радужные полосы плывут
//   10 Галактика           — тёмное небо с туманностью и мигающими звёздами
//   11 Жемчужный перелив   — перламутр переливается, по нему пробегает блик
//   12 Летящие сердечки    — сердечки поднимаются вверх и покачиваются
import { mulberry32, patternFor, heart } from './effects.js';

const mkc = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

let starSprite = null;
function sprite() {  // мягкая четырёхлучевая звёздочка
  if (starSprite) return starSprite;
  const c = mkc(48, 48), x = c.getContext('2d');
  const g = x.createRadialGradient(24, 24, 0, 24, 24, 24);
  g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.25, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 48, 48);
  x.fillStyle = '#fff';
  x.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, r = i % 2 ? 4 : 23; x.lineTo(24 + Math.cos(a) * r, 24 + Math.sin(a) * r); }
  x.closePath(); x.fill();
  return (starSprite = c);
}

let nebula = null;
function nebulaTile() {  // бесшовная плитка «космоса»
  if (nebula) return nebula;
  const S = 512, c = mkc(S, S), x = c.getContext('2d');
  x.fillStyle = '#241a52'; x.fillRect(0, 0, S, S);
  const rnd = mulberry32(2024);
  const blobs = [['#7b3fb0', 0.55], ['#2f4fb8', 0.5], ['#c04fa0', 0.4], ['#3aa0c8', 0.35]];
  for (let i = 0; i < 14; i++) {
    const [col, a] = blobs[i % blobs.length];
    const bx = rnd() * S, by = rnd() * S, br = 90 + rnd() * 130;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {   // обёртка по краям: плитка бесшовная
      const g = x.createRadialGradient(bx + ox, by + oy, 0, bx + ox, by + oy, br);
      g.addColorStop(0, col + Math.round(a * 255).toString(16).padStart(2, '0')); g.addColorStop(1, col + '00');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
    }
  }
  x.fillStyle = 'rgba(255,255,255,.8)';
  for (let i = 0; i < 70; i++) { x.beginPath(); x.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 1.0, 0, 6.2832); x.fill(); }
  return (nebula = c);
}

export class Animator {
  constructor(paint) {
    this.paint = paint;
    this.W = paint.w; this.H = paint.h;
    this.q = 0.5;   // живой слой рисуется вдвое мельче (в 4 раза меньше пикселей): плавнее на слабом планшете
    this.sc = null; this.sx = null; this.mq = {};
    this.stars = {}; this.hearts = null;
    this.pats = {};
  }

  _scratch() {
    if (!this.sc) { this.sc = mkc(Math.ceil(this.W * this.q), Math.ceil(this.H * this.q)); this.sx = this.sc.getContext('2d'); }
    return this.sx;
  }

  /** Уменьшенные формы красок (вызывать после любого изменения красок). */
  refreshMasks() {
    for (const key of Object.keys(this.paint.anim)) {
      const e = +key;
      if (!this.mq[e]) this.mq[e] = mkc(Math.ceil(this.W * this.q), Math.ceil(this.H * this.q));
      const x = this.mq[e].getContext('2d');
      x.clearRect(0, 0, this.mq[e].width, this.mq[e].height);
      x.drawImage(this.paint.maskFor(e), 0, 0, this.W, this.H, 0, 0, this.mq[e].width, this.mq[e].height);
    }
  }

  _starList(key, density, seed) {
    if (this.stars[key]) return this.stars[key];
    const rnd = mulberry32(seed), n = Math.round((this.W * this.H) / density), a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { a[i * 4] = rnd() * this.W; a[i * 4 + 1] = rnd() * this.H; a[i * 4 + 2] = rnd() * 6.2832; a[i * 4 + 3] = 0.6 + rnd() * 1.1; }
    return (this.stars[key] = a);
  }

  _twinkles(ctx, rect, t, list, speed, size, tint) {
    const sp = sprite();
    for (let i = 0; i < list.length; i += 4) {
      const x = list[i], y = list[i + 1];
      if (x < rect.x0 - 12 || x > rect.x1 + 12 || y < rect.y0 - 12 || y > rect.y1 + 12) continue;
      const a = Math.sin(t * speed + list[i + 2]) * 0.5 + 0.5, k = a * a * a;   // короткая яркая вспышка
      if (k < 0.04) continue;
      const s = size * list[i + 3] * (0.6 + 0.6 * k);
      ctx.globalAlpha = Math.min(1, k * 1.25);
      ctx.drawImage(sp, x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    if (tint) ctx.globalAlpha = 1;
  }

  _texture(ctx, e, t, rect) {
    const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
    switch (e) {
      case 8:   // мерцающие блёстки
        this._twinkles(ctx, rect, t, this._starList('t8', 650, 8), 2.4, 26, false);
        break;
      case 9: { // радужный перелив
        const p = this.pats[9] || (this.pats[9] = patternFor(ctx, 'rainbow'));
        p.setTransform(new DOMMatrix().rotate(28).translate(t * 55, 0));
        ctx.fillStyle = p; ctx.fillRect(rect.x0, rect.y0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(rect.x0, rect.y0, w, h);   // пастельнее, «леденцовый» вид
        break;
      }
      case 10: { // галактика
        const p = this.pats[10] || (this.pats[10] = ctx.createPattern(nebulaTile(), 'repeat'));
        p.setTransform(new DOMMatrix().translate(t * 6, t * 2.5));
        ctx.fillStyle = p; ctx.fillRect(rect.x0, rect.y0, w, h);
        this._twinkles(ctx, rect, t, this._starList('g10', 520, 10), 1.9, 20, false);
        break;
      }
      case 11: { // жемчужный перелив + бегущий блик
        const p = this.pats[11] || (this.pats[11] = patternFor(ctx, 'pearl'));
        p.setTransform(new DOMMatrix().rotate(60).translate(t * 30, 0));
        ctx.fillStyle = p; ctx.fillRect(rect.x0, rect.y0, w, h);
        const span = w + h + 240, pos = ((t * 150) % (span + 300)) - 150 + rect.x0 - h * 0.3;
        const g = ctx.createLinearGradient(pos - 70, 0, pos + 70, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.65)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(rect.x0, rect.y0, w, h);
        this._twinkles(ctx, rect, t, this._starList('p11', 1800, 11), 1.5, 16, false);
        break;
      }
      case 12: { // летящие сердечки
        if (!this.hearts) {
          const rnd = mulberry32(12), n = Math.max(40, Math.round((this.W * this.H) / 9000)), a = [];
          for (let i = 0; i < n; i++) a.push({ x: rnd() * this.W, y0: rnd() * (this.H + 60), v: 22 + rnd() * 26, s: 7 + rnd() * 9, ph: rnd() * 6.2832, c: ['#ff6f9c', '#ffffff', '#ff9ec0', '#e8486f'][i % 4] });
          this.hearts = a;
        }
        const H2 = this.H + 60;
        for (const q of this.hearts) {
          const y = this.H + 30 - ((q.y0 + t * q.v) % H2), x = q.x + Math.sin(t * 1.2 + q.ph) * 9;
          if (x < rect.x0 - 20 || x > rect.x1 + 20 || y < rect.y0 - 20 || y > rect.y1 + 20) continue;
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = q.c;
          heart(ctx, x, y, q.s, Math.sin(t + q.ph) * 0.3);
        }
        ctx.globalAlpha = 1;
        break;
      }
      default: break;
    }
  }

  /** Нарисовать все живые краски поверх слоя краски. ctx — основной холст с трансформацией картинки. */
  draw(ctx, t) {
    const sx = this._scratch();
    for (let [key, r] of Object.entries(this.paint.anim)) {
      const e = +key;
      // рамка по чётным координатам: при масштабе 0,5 границы попадают точно на пиксели (иначе по краю остаётся полоска)
      r = { x0: r.x0 & ~1, y0: r.y0 & ~1, x1: Math.min(this.W, (r.x1 + 1) & ~1), y1: Math.min(this.H, (r.y1 + 1) & ~1) };
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      if (w <= 0 || h <= 0) continue;
      if (!this.mq[e]) this.refreshMasks();
      const q = this.q;
      sx.save();
      sx.setTransform(q, 0, 0, q, 0, 0);                      // рисуем в координатах картинки, но вдвое мельче
      sx.globalCompositeOperation = 'source-over';
      sx.clearRect(r.x0, r.y0, w, h);
      sx.beginPath(); sx.rect(r.x0, r.y0, w, h); sx.clip();
      this._texture(sx, e, t, r);
      sx.setTransform(1, 0, 0, 1, 0, 0);
      sx.globalCompositeOperation = 'destination-in';         // оставляем только там, где лежит эта краска
      sx.drawImage(this.mq[e], 0, 0);
      sx.restore();
      ctx.drawImage(this.sc, r.x0 * q, r.y0 * q, w * q, h * q, r.x0, r.y0, w, h);
    }
  }
}
