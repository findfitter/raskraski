// «Соедини точки»: ребёнок по порядку соединяет пронумерованные точки по контуру фигуры,
// в конце проступает готовая раскрашенная картина.
import { CATALOG } from './catalog.js';
import { DOTS } from './dots-data.js';
import { loadPicture } from './loader.js';
import { kitOptsFor, kitVariantFor, kitFor, tintLines, renderPreview } from './kit-style.js';
import { star5, heart } from './effects.js';

const $ = (id) => document.getElementById(id);
const ID = 'p03';
const entry = CATALOG.find((e) => e.id === ID);
const PTS = DOTS[ID].pts;
const N = PTS.length;
const W = 1312, H = 816;
const DOT_R = 17;            // радиус точки в пикселях картинки
const HIT_PX = 46;           // радиус касания точки на экране (px): удобно пальцем
const START_PX = 70;         // откуда можно начинать тянуть линию от последней точки (px)

const cv = $('cv'), host = $('host'), ctx = cv.getContext('2d', { alpha: false });
let dpr = 1, vw = 0, vh = 0, s = 1, tx = 0, ty = 0, fit = 1;
let cur = -1;                // номер последней соединённой точки (−1 — ещё не начали)
let finished = false, revealStart = 0;
let rubber = null;           // конец «резиновой» линии при протягивании пальца
let dragging = false;
let finalCanvas = null;
let particles = [];
const pointers = new Map();
let pinch = null, multi = false;
let raf = 0;

// ---------- мелочи ----------
let toastTimer = 0;
function toast(msg, ms = 1700) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const target = () => (cur + 1 < N ? cur + 1 : 0);     // после последней точки — замыкаем на первую
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- вид ----------
function resize() {
  const r = host.getBoundingClientRect();
  vw = Math.max(1, Math.round(r.width)); vh = Math.max(1, Math.round(r.height));
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  const wasFit = s <= fit * 1.001;
  fit = Math.min((vw - 40) / W, (vh - 40) / H);
  if (wasFit) resetView(); else clampView();
  invalidate();
}
function resetView() { s = fit; tx = (vw - W * s) / 2; ty = (vh - H * s) / 2; invalidate(); }
function clampView() {
  const iw = W * s, ih = H * s, m = 40;
  tx = iw <= vw ? (vw - iw) / 2 : Math.min(m, Math.max(vw - iw - m, tx));
  ty = ih <= vh ? (vh - ih) / 2 : Math.min(m, Math.max(vh - ih - m, ty));
}
function zoomAt(f, px, py) {
  const ns = Math.min(fit * 5, Math.max(fit, s * f)), k = ns / s;
  tx = px - (px - tx) * k; ty = py - (py - ty) * k; s = ns; clampView(); invalidate();
}
const toImg = (cx, cy) => { const r = cv.getBoundingClientRect(); return [(cx - r.left - tx) / s, (cy - r.top - ty) / s]; };
const dotAt = (x, y, rpx) => {   // ближайшая точка в радиусе rpx экранных пикселей или −1
  let best = -1, bd = rpx / s;
  for (let i = 0; i < N; i++) { const d = Math.hypot(PTS[i][0] - x, PTS[i][1] - y); if (d < bd) { bd = d; best = i; } }
  return best;
};

// ---------- игра ----------
function connect(i) {
  if (cur === -1) { cur = 0; }
  else if (i === 0 && cur === N - 1) { finish(); return; }
  else cur = i;
  burst(PTS[cur][0], PTS[cur][1], 6, 0.5);
  updateUI(); invalidate();
}
function finish() {
  finished = true; rubber = null; dragging = false;
  revealStart = performance.now();
  updateUI();
  const c = PTS.reduce((a, p) => [a[0] + p[0] / N, a[1] + p[1] / N], [0, 0]);
  burst(c[0], c[1], 90, 1.6, true);
  $('donetitle').textContent = 'Получилась «' + entry.title + '»! 🎉';
  setTimeout(() => { if (finished) $('done').hidden = false; }, 1500);
  invalidate();
}
function wrong(i) {
  const need = cur === -1 ? 1 : target() + 1;
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  host.classList.remove('shake'); void host.offsetWidth; host.classList.add('shake');
  toast(i >= 0 ? `Сейчас нужна точка ${need}` : `Ищи точку ${need}`);
}
function undo() {
  if (finished) { finished = false; $('done').hidden = true; }
  else if (cur >= 0) cur--;
  rubber = null; dragging = false;
  updateUI(); invalidate();
}
function restart() {
  cur = -1; finished = false; rubber = null; dragging = false; particles = [];
  $('done').hidden = true;
  updateUI(); invalidate();
}
function updateUI() {
  $('progress').textContent = finished ? `${N} из ${N} ✓` : `${Math.max(0, cur + 1)} из ${N}`;
  $('btn-undo').disabled = cur < 0 && !finished;
}

// ---------- конфетти ----------
function burst(x, y, n, power, rain = false) {
  const cols = ['#ff6f9c', '#ffd54a', '#7bc8f6', '#9be26d', '#c9a6e8', '#ff9a4d'];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.2832, v = (60 + Math.random() * 260) * power;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (rain ? 160 : 40), life: 0.9 + Math.random() * 1.3, age: 0, size: 5 + Math.random() * 9, c: cols[i % cols.length], heart: i % 3 === 0, rot: Math.random() * 6 });
  }
}

// ---------- отрисовка ----------
function invalidate() { if (!raf) raf = requestAnimationFrame(draw); }
let lastT = performance.now();
function draw(now) {
  raf = 0;
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#d9d0c4';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
  // лист бумаги
  ctx.save();
  ctx.shadowColor = 'rgba(70,50,30,.35)'; ctx.shadowBlur = 24 * dpr; ctx.shadowOffsetY = 8 * dpr;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  // готовая картина проступает
  let reveal = 0;
  if (finished) reveal = Math.min(1, (now - revealStart) / 1800);
  if (finalCanvas && reveal > 0) { ctx.globalAlpha = smooth(reveal); ctx.drawImage(finalCanvas, 0, 0); ctx.globalAlpha = 1; }
  // линии
  const lineA = 1 - smooth(Math.min(1, reveal * 1.4));   // точки и линии растворяются, остаётся только картина
  ctx.globalAlpha = lineA;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (cur >= 1 || finished) {
    ctx.strokeStyle = '#e8738f'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(PTS[0][0], PTS[0][1]);
    for (let i = 1; i <= cur; i++) ctx.lineTo(PTS[i][0], PTS[i][1]);
    if (finished) ctx.closePath();
    ctx.stroke();
  }
  if (rubber && cur >= 0 && !finished) {
    ctx.strokeStyle = 'rgba(232,115,143,.55)'; ctx.lineWidth = 7; ctx.setLineDash([2, 12]);
    ctx.beginPath(); ctx.moveTo(PTS[cur][0], PTS[cur][1]); ctx.lineTo(rubber[0], rubber[1]); ctx.stroke(); ctx.setLineDash([]);
  }
  // точки
  const t = now / 1000, tgt = finished ? -1 : target();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 17px "Segoe UI", Roboto, Arial, sans-serif';
  for (let i = 0; i < N; i++) {
    const [x, y] = PTS[i];
    const done = i <= cur || finished;
    const isTarget = i === tgt && !finished;
    if (isTarget) {   // пульсирующее кольцо вокруг следующей точки
      ctx.globalAlpha = lineA * (0.55 + 0.35 * Math.sin(t * 6));
      ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, DOT_R + 7 + 4 * Math.sin(t * 6), 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = lineA;
    }
    ctx.fillStyle = done ? '#5bb36b' : isTarget ? '#ff8a3d' : '#ffffff';
    ctx.strokeStyle = done ? '#2f7d4f' : isTarget ? '#b8540f' : '#7a5fa3';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, DOT_R, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.fillStyle = done || isTarget ? '#fff' : '#3d3350';
    ctx.fillText(String(i + 1), x, y + 1);
  }
  if (cur === -1) {  // подсказка у первой точки
    ctx.globalAlpha = 1;
    const [x, y] = PTS[0];
    ctx.font = '800 26px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillStyle = '#b8540f'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
    ctx.strokeText('Начни здесь!', x + 215, y + 8); ctx.fillText('Начни здесь!', x + 215, y + 8);
  }
  ctx.globalAlpha = 1;
  // конфетти
  for (const p of particles) {
    p.age += dt; p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 4;
    const a = Math.max(0, 1 - p.age / p.life);
    ctx.globalAlpha = a; ctx.fillStyle = p.c;
    if (p.heart) heart(ctx, p.x, p.y, p.size * 0.6, p.rot * 0.2); else star5(ctx, p.x, p.y, p.size, p.rot);
  }
  ctx.globalAlpha = 1;
  particles = particles.filter((p) => p.age < p.life);

  // кадры идут, пока есть что оживлять: пульс следующей точки, конфетти, проявление
  if (!finished || particles.length || reveal < 1) invalidate();
}

// ---------- ввод ----------
cv.addEventListener('pointerdown', (e) => {
  try { cv.setPointerCapture(e.pointerId); } catch { /* синтетические события */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) {   // второй палец — щипок; начатая линия отменяется
    multi = true; dragging = false; rubber = null;
    const [a, b] = [...pointers.values()];
    const r = cv.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s0: s, ix: (mx - tx) / s, iy: (my - ty) / s };
    invalidate();
    return;
  }
  multi = false;
  if (finished) return;
  const [x, y] = toImg(e.clientX, e.clientY);
  const hit = dotAt(x, y, HIT_PX);
  if (cur === -1) {
    if (hit === 0) { connect(0); dragging = true; rubber = [x, y]; } else wrong(hit);
    return;
  }
  if (hit === target()) { connect(hit); if (!finished) { dragging = true; rubber = [x, y]; } return; }   // тап по следующей точке
  const nearCur = Math.hypot(PTS[cur][0] - x, PTS[cur][1] - y) < START_PX / s;
  if (hit === cur || nearCur) { dragging = true; rubber = [x, y]; invalidate(); return; }
  if (hit >= 0) wrong(hit);
});
cv.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const px = p.x, py = p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size >= 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const r = cv.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    const ns = Math.min(fit * 5, Math.max(fit, pinch.s0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
    s = ns; tx = mx - pinch.ix * ns; ty = my - pinch.iy * ns; clampView(); invalidate();
    return;
  }
  if (dragging && !finished) {
    const [x, y] = toImg(e.clientX, e.clientY);
    rubber = [x, y];
    const hit = dotAt(x, y, HIT_PX * 0.85);
    if (hit === target()) { connect(hit); if (!finished) rubber = [x, y]; }   // дотянул до следующей точки — линия «защёлкнулась»
    invalidate();
  } else if (e.pointerType === 'mouse' && e.buttons & 6) { tx += e.clientX - px; ty += e.clientY - py; clampView(); invalidate(); }
});
const up = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) { dragging = false; rubber = null; multi = false; invalidate(); }
};
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
$('z-in').onclick = () => zoomAt(1.5, vw / 2, vh / 2);
$('z-out').onclick = () => zoomAt(1 / 1.5, vw / 2, vh / 2);
$('z-fit').onclick = resetView;
$('btn-undo').onclick = undo;
$('btn-restart').onclick = restart;
$('btn-again').onclick = restart;
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } });
new ResizeObserver(resize).observe(host);

// ---------- готовая картина ----------
async function buildFinal() {
  $('loading').hidden = false;
  try {
    const p = await loadPicture(entry, { key: 'c-' + ID, opts: kitOptsFor(ID), variant: kitVariantFor(ID) });
    const k = kitFor(ID, p.regions);
    tintLines(p.lineCanvas, k.line);
    finalCanvas = renderPreview({ ...p, regions: { ...p.regions, color: k.color } }, k.color, k.pots, p.w);
  } catch (err) { console.error(err); toast('Не удалось подготовить картинку'); }
  $('loading').hidden = true;
  invalidate();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
resize(); updateUI(); buildFinal();

// для автотестов
window.__dots = {
  PTS, N, get cur() { return cur; }, get finished() { return finished; }, get finalReady() { return !!finalCanvas; },
  get dragging() { return dragging; }, get scale() { return s; }, get fit() { return fit; },
  screenOf(i) { const r = cv.getBoundingClientRect(); return { x: r.left + PTS[i][0] * s + tx, y: r.top + PTS[i][1] * s + ty }; },
  undo, restart,
};
