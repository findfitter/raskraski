// Модель раскрашивания: список шагов (заливка области или мазок кистью) для отмены/повтора.
// Копий холста нет: после отмены слой краски области перерисовывается по её шагам.
//
// Шаг-заливка: {k:'f', r, c, e, s}            область r, цвет c (0xRRGGBB), эффект e, seed узора
// Шаг-мазок:   {k:'s', r, c, e, z, s, p:[..]}  область r, диаметр z, точки p = [x*4, y*4, ...]
import { baseColor } from './effects.js';

const CELL = 6;       // сетка покрытия: по ней считается, насколько область закрашена кистью
const FULL_AT = 0.75; // область считается закрашенной, когда мазками покрыто 75% её клеток

/** Прежний формат прогресса (плоский список [область, цвет, ...]) → шаги-заливки. */
export function normalizeSteps(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  if (typeof raw[0] !== 'number') return raw;
  const out = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push({ k: 'f', r: raw[i], c: raw[i + 1], e: 0, s: 0 });
  return out;
}

export class Session {
  constructor(regions, rawSteps = []) {
    this.regions = regions;
    this.K = regions.count;
    this.cur = new Int32Array(this.K + 1).fill(-1); // цвет подложки заливки области или -1
    this.steps = [];
    this.redoStack = [];
    this.byRegion = Array.from({ length: this.K + 1 }, () => []);
    this.painted = 0; // областей с заливкой

    const { w, h, map } = regions;
    this.gw = Math.ceil(w / CELL); this.gh = Math.ceil(h / CELL);
    this.cellReg = new Uint16Array(this.gw * this.gh);
    this.cellsTotal = new Int32Array(this.K + 1);
    for (let cy = 0; cy < this.gh; cy++) {
      for (let cx = 0; cx < this.gw; cx++) {
        const x = Math.min(w - 1, cx * CELL + (CELL >> 1)), y = Math.min(h - 1, cy * CELL + (CELL >> 1));
        const r = map[y * w + x];
        this.cellReg[cy * this.gw + cx] = r;
        this.cellsTotal[r]++;
      }
    }
    this.cellBits = new Uint8Array(this.gw * this.gh);
    this.covCount = new Int32Array(this.K + 1);

    for (const st of normalizeSteps(rawSteps)) if (st && st.r >= 1 && st.r <= this.K) this._push(st);
  }

  // ---------- внутреннее ----------
  _push(st) {
    this.steps.push(st);
    this.byRegion[st.r].push(st);
    if (st.k === 'f') {
      if (this.cur[st.r] < 0) this.painted++;
      this.cur[st.r] = baseColor(st.e, st.c);
    } else this._markStroke(st);
  }

  _pop() {
    const st = this.steps.pop();
    this.byRegion[st.r].pop();
    this._recompute(st.r);
    return st;
  }

  _recompute(r) {
    const list = this.byRegion[r];
    let lastFill = -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].k === 'f') { lastFill = i; break; }
    const was = this.cur[r];
    this.cur[r] = lastFill >= 0 ? baseColor(list[lastFill].e, list[lastFill].c) : -1;
    if (was < 0 && this.cur[r] >= 0) this.painted++;
    if (was >= 0 && this.cur[r] < 0) this.painted--;
    // покрытие мазками: пересчитываем с нуля
    const b = this.regions.bbox, g = this.gw;
    for (let cy = Math.floor(b[r * 4 + 1] / CELL); cy <= Math.floor(b[r * 4 + 3] / CELL); cy++)
      for (let cx = Math.floor(b[r * 4] / CELL); cx <= Math.floor(b[r * 4 + 2] / CELL); cx++)
        if (this.cellReg[cy * g + cx] === r) this.cellBits[cy * g + cx] = 0;
    this.covCount[r] = 0;
    for (let i = Math.max(lastFill, 0); i < list.length; i++) if (list[i].k === 's') this._markStroke(list[i]);
  }

  _markDisc(x, y, rad, r) {
    const g = this.gw;
    const x0 = Math.max(0, Math.floor((x - rad) / CELL)), x1 = Math.min(g - 1, Math.floor((x + rad) / CELL));
    const y0 = Math.max(0, Math.floor((y - rad) / CELL)), y1 = Math.min(this.gh - 1, Math.floor((y + rad) / CELL));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * g + cx;
        if (this.cellReg[i] !== r || this.cellBits[i]) continue;
        const dx = cx * CELL + CELL / 2 - x, dy = cy * CELL + CELL / 2 - y;
        if (dx * dx + dy * dy <= rad * rad) { this.cellBits[i] = 1; this.covCount[r]++; }
      }
    }
  }

  _markStroke(st) {
    const rad = st.z / 2 + 1, p = st.p, step = Math.max(2, st.z / 4);
    let px = p[0] / 4, py = p[1] / 4;
    this._markDisc(px, py, rad, st.r);
    for (let i = 2; i < p.length; i += 2) {
      const x = p[i] / 4, y = p[i + 1] / 4;
      const n = Math.ceil(Math.hypot(x - px, y - py) / step);
      for (let k = 1; k <= n; k++) this._markDisc(px + ((x - px) * k) / n, py + ((y - py) * k) / n, rad, st.r);
      px = x; py = y;
    }
  }

  // ---------- действия ----------
  /** Залить область (с эффектом). null — ничего не изменилось. */
  fill(r, rgb, e = 0, seed = 0) {
    if (r < 1 || r > this.K) return null;
    if (e === 0) {
      const l = this.byRegion[r][this.byRegion[r].length - 1];
      if (l && l.k === 'f' && l.e === 0 && l.c === rgb) return null;
    }
    const st = { k: 'f', r, c: rgb, e, s: seed };
    this._push(st);
    this.redoStack.length = 0;
    return st;
  }

  /** Совместимость: простая заливка. */
  paint(r, rgb) { return !!this.fill(r, rgb, 0, 0); }

  /** Добавить уже нарисованный на слое мазок. */
  addStroke(st) {
    this._push(st);
    this.redoStack.length = 0;
  }

  canUndo() { return this.steps.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  lastStep() { return this.steps[this.steps.length - 1] || null; }

  /** → шаг, который отменили (его область нужно перерисовать) */
  undo() {
    if (!this.steps.length) return null;
    const st = this._pop();
    this.redoStack.push(st);
    return st;
  }

  redo() {
    if (!this.redoStack.length) return null;
    const st = this.redoStack.pop();
    this._push(st);
    return st;
  }

  /** Шаги области, влияющие на слой краски: с последней заливки. */
  stepsOfRegion(r) {
    const list = this.byRegion[r];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].k === 'f') return list.slice(i);
    return list;
  }

  clear() {
    this.cur.fill(-1);
    this.steps.length = 0;
    this.redoStack.length = 0;
    this.painted = 0;
    this.cellBits.fill(0);
    this.covCount.fill(0);
    for (const l of this.byRegion) l.length = 0;
  }

  /** Доля закрашенности области 0..1 (заливка = 1, иначе по покрытию мазками). */
  fraction(r) {
    if (this.cur[r] >= 0) return 1;
    const t = this.cellsTotal[r];
    if (!t) return this.byRegion[r].length ? 1 : 0;
    return Math.min(1, this.covCount[r] / (t * FULL_AT));
  }

  percent() {
    if (!this.K) return 0;
    let s = 0;
    for (let r = 1; r <= this.K; r++) s += this.fraction(r);
    return Math.round((100 * s) / this.K);
  }
}
