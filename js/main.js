import { CATALOG, MAX_SIDE } from './catalog.js';
import { ALGO, NCOLORS } from './regions.js';
import { NUM_COLORS, FREE_COLORS, hexOf, inkOn } from './palette.js';
import { Session, normalizeSteps } from './paint.js';
import { EFFECTS, BRUSH_SIZES } from './effects.js';
import { Viewer } from './viewer.js';
import * as db from './db.js';
import { computeAny } from './loader.js';

const $ = (id) => document.getElementById(id);
const el = {
  gallery: $('gallery'), grid: $('grid'), paint: $('paint'), host: $('host'), cv: $('cv'), palette: $('palette'),
  loading: $('loading'), loadingText: $('loading-text'), pct: $('pct'), toast: $('toast'),
  undo: $('btn-undo'), redo: $('btn-redo'), hint: $('btn-hint'),
  modeFree: $('mode-free'), modeNum: $('mode-num'), badge: $('offline-badge'),
};

// ---------- состояние ----------
let viewer = null;
let session = null;
let pic = null;            // {id, w, h, lineCanvas, regions}
let curId = null;
let mode = 'free';
let freeColor = FREE_COLORS[0].rgb;
let freeKey = 's0';
let customColor = null;
let tool = 'brush';        // 'fill' — заливка области, 'brush' — кисть
let brushIdx = 1;          // индекс диаметра в BRUSH_SIZES
let effect = 0;            // выбранный эффект (0 = обычная краска)
let lastDot = 0;           // время последней точки-мазка (для двойного нажатия)
let numSel = 0;            // выбранный номер цвета (0 = не выбран)
let hintLast = 0;
let openToken = 0;
const thumbUrls = [];

// ---------- мелочи интерфейса ----------
let toastTimer = 0;
function toast(msg, ms = 1900) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}

function confirmDialog(title, text, okLabel = 'Да') {
  return new Promise((resolve) => {
    $('modal-title').textContent = title;
    $('modal-text').textContent = text;
    $('modal-ok').textContent = okLabel;
    $('modal').hidden = false;
    const done = (v) => { $('modal').hidden = true; $('modal-ok').onclick = $('modal-cancel').onclick = null; resolve(v); };
    $('modal-ok').onclick = () => done(true);
    $('modal-cancel').onclick = () => done(false);
  });
}

// ---------- загрузка картинки и расчёт областей ----------
async function decodeToCanvas(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff';
  x.fillRect(0, 0, w, h);
  x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return c;
}

function grayOf(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, k = 0; i < g.length; i++, k += 4) g[i] = (d[k] * 77 + d[k + 1] * 150 + d[k + 2] * 29) >> 8;
  return g;
}

/** Картинка + карта областей. Карта считается один раз и кэшируется в IndexedDB. */
async function loadPicture(entry, { force = false } = {}) {
  const t0 = performance.now();
  const lineCanvas = await decodeToCanvas(entry.file);
  const { width: w, height: h } = lineCanvas;
  let regions = force ? null : await db.getRegions(entry.id).catch(() => null);
  let fromCache = false;
  if (regions && (regions.algo !== ALGO || regions.w !== w || regions.h !== h)) regions = null;
  if (regions) fromCache = true;
  else {
    regions = await computeAny(grayOf(lineCanvas), w, h);
    if (!force) await db.putRegions({ id: entry.id, ...regions }).catch((e) => console.warn('кэш областей не записан', e));
  }
  return { id: entry.id, w, h, lineCanvas, regions, fromCache, ms: Math.round(performance.now() - t0) };
}

// ---------- галерея ----------
function clearThumbUrls() { while (thumbUrls.length) URL.revokeObjectURL(thumbUrls.pop()); }

async function renderGallery() {
  clearThumbUrls();
  let prog = [];
  try { prog = await db.allProgress(); } catch (e) { console.warn(e); }
  const byId = new Map(prog.map((p) => [p.id, p]));
  el.grid.textContent = '';
  for (const e of CATALOG) {
    const p = byId.get(e.id);
    const pct = p && p.algo === ALGO ? p.percent || 0 : 0;
    const b = document.createElement('button');
    b.className = 'tile' + (pct > 0 ? ' started' : '') + (pct >= 100 ? ' done' : '');
    b.dataset.id = e.id;
    let src = e.file;
    if (p && p.thumb && pct > 0) { src = URL.createObjectURL(p.thumb); thumbUrls.push(src); }
    b.innerHTML = `<img class="thumb" alt="" draggable="false"><div class="meta"><span class="name"></span><span class="pbadge"></span></div><div class="bar"><i></i></div>`;
    b.querySelector('img').src = src;
    b.querySelector('.name').textContent = e.title;
    b.querySelector('.pbadge').textContent = pct + '%';
    b.querySelector('.bar i').style.width = pct + '%';
    b.addEventListener('click', () => { location.hash = '#' + e.id; });
    el.grid.appendChild(b);
  }
}

// ---------- маршрутизация ----------
async function route() {
  const id = location.hash.slice(1);
  const entry = CATALOG.find((e) => e.id === id);
  if (entry) { if (curId !== id) await openPicture(entry); }
  else await showGallery();
}

async function showGallery() {
  openToken++;
  if (curId) { await flushSave(); }
  curId = null; session = null; pic = null;
  el.paint.hidden = true;
  el.gallery.hidden = false;
  await renderGallery();
}

async function openPicture(entry) {
  const token = ++openToken;
  if (curId) await flushSave();
  curId = entry.id;
  el.gallery.hidden = true;
  el.paint.hidden = false;
  el.loading.hidden = false;
  el.loadingText.textContent = 'Готовлю картинку…';
  if (!viewer) viewer = new Viewer(el.cv, el.host, { onTap, getBrush, onStroke, onDoubleTap });
    viewer.animate = animPref();
    syncAnimBtn();
  try {
    const cached = await db.getRegions(entry.id).catch(() => null);
    if (!(cached && cached.algo === ALGO)) el.loadingText.textContent = 'Ищу области (первый раз, это недолго)…';
    const p = await loadPicture(entry);
    if (token !== openToken) return;
    let steps = [];
    const prog = await db.getProgress(entry.id).catch(() => null);
    if (prog && prog.algo === ALGO && Array.isArray(prog.steps)) steps = normalizeSteps(prog.steps);
    pic = p;
    session = new Session(p.regions, steps);
    viewer.load(p, session);
    viewer.setMode(mode);
    applyTool();
    numSel = 0; hintLast = 0;
    if (mode === 'num') numSel = nextColorWithWork() || 0;
    buildPalette();
    updateUI();
  } catch (err) {
    console.error(err);
    toast('Не удалось открыть картинку');
    location.hash = '';
  } finally {
    if (token === openToken) el.loading.hidden = true;
  }
}

// ---------- сохранение ----------
let saveTimer = 0;
let saveChain = Promise.resolve();
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveChain = saveChain.then(saveNow); }, 500);
}
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; saveChain = saveChain.then(saveNow); }
  return saveChain;
}
async function saveNow() {
  saveTimer = 0;
  if (!session || !curId || !viewer) return;
  const id = curId;
  try {
    if (!session.steps.length) { await db.delProgress(id); return; }
    const thumb = await new Promise((res) => viewer.makeThumb(420).toBlob(res, 'image/jpeg', 0.82));
    await db.putProgress({ id, algo: ALGO, fmt: 2, steps: session.steps.slice(), percent: session.percent(), updated: Date.now(), thumb });
  } catch (e) { console.warn('Не удалось сохранить', e); toast('Не удалось сохранить прогресс'); }
}

// ---------- палитра ----------
function remainingByColor() {
  const left = new Int32Array(NCOLORS + 1);
  const R = pic.regions;
  for (let r = 1; r <= R.count; r++) if (session.cur[r] < 0) left[R.color[r]]++;
  return left;
}
function nextColorWithWork() {
  const R = pic.regions;
  let best = 0, bestA = -1;
  for (let r = 1; r <= R.count; r++) if (session.cur[r] < 0 && R.area[r] > bestA) { bestA = R.area[r]; best = R.color[r]; }
  return best;
}

function buildPalette() {
  const P = el.palette;
  P.textContent = '';
  P.classList.toggle('numbers', mode === 'num');
  if (mode === 'free') {
    const sec = (t) => { const d = document.createElement('div'); d.className = 'sec'; d.textContent = t; P.appendChild(d); };
    sec('Инструмент');
    const mkTool = (key, label, html) => {
      const b = document.createElement('button');
      b.className = 'sw tool'; b.dataset.tool = key; b.setAttribute('aria-label', label); b.title = label;
      b.innerHTML = html;
      b.onclick = () => { if (key === 'fill') tool = 'fill'; else { tool = 'brush'; brushIdx = +key.slice(1); } applyTool(); markFreeSel(); };
      P.appendChild(b);
    };
    mkTool('fill', 'Заливка области', '<svg viewBox="0 0 24 24"><path d="M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z"/></svg>');
    const dots = [8, 14, 22, 32];
    BRUSH_SIZES.forEach((z, i) => mkTool('b' + i, 'Кисть ' + (i + 1), `<i class="dot" style="width:${dots[i]}px;height:${dots[i]}px"></i>`));
    const glyph = { 1: '✦', 3: '♥', 4: '★', 8: '✦', 12: '♥' };
    const mkFx = (fx) => {
      const b = document.createElement('button');
      b.className = 'sw fx fx-' + fx.key; b.dataset.fx = fx.id; b.setAttribute('aria-label', fx.name); b.title = fx.name;
      b.textContent = glyph[fx.id] || '';
      b.onclick = () => { effect = fx.id; markFreeSel(); toast(fx.name, 900); };
      P.appendChild(b);
    };
    sec('Эффекты');
    EFFECTS.filter((f) => !f.anim).forEach(mkFx);
    sec('Волшебные краски');
    EFFECTS.filter((f) => f.anim).forEach(mkFx);
    sec('Цвета');
    FREE_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'sw';
      b.style.background = c.hex;
      b.dataset.key = 's' + i;
      b.setAttribute('aria-label', 'Цвет ' + c.hex);
      b.onclick = () => { freeColor = c.rgb; freeKey = 's' + i; markFreeSel(); };
      P.appendChild(b);
    });
    const lab = document.createElement('label');
    lab.className = 'sw custom';
    lab.dataset.key = 'c';
    lab.setAttribute('aria-label', 'Свой цвет');
    lab.innerHTML = '<input type="color"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    const inp = lab.querySelector('input');
    inp.value = customColor != null ? hexOf(customColor) : '#ff5722';
    if (customColor != null) lab.style.background = hexOf(customColor);
    const setCustom = () => {
      customColor = parseInt(inp.value.slice(1), 16);
      freeColor = customColor; freeKey = 'c';
      lab.style.background = hexOf(customColor);
      markFreeSel();
    };
    inp.addEventListener('input', setCustom);
    inp.addEventListener('change', setCustom);
    P.appendChild(lab);
    markFreeSel();
  } else {
    const left = remainingByColor();
    NUM_COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'sw' + (numSel === c.n ? ' sel' : '') + (left[c.n] === 0 ? ' done' : '');
      b.style.background = c.hex;
      b.style.color = inkOn(c.rgb);
      b.dataset.n = c.n;
      b.setAttribute('aria-label', `Цвет ${c.n}, ${c.name}`);
      b.innerHTML = `<span>${c.n}</span><span class="left">${left[c.n] === 0 ? '✓' : left[c.n]}</span>`;
      b.onclick = () => { numSel = c.n; markNumSel(); };
      P.appendChild(b);
    });
  }
}
function markFreeSel() {
  el.palette.style.setProperty('--cur', hexOf(freeColor));
  const toolKey = tool === 'fill' ? 'fill' : 'b' + brushIdx;
  for (const b of el.palette.children) {
    if (b.dataset.tool !== undefined) b.classList.toggle('sel', b.dataset.tool === toolKey);
    else if (b.dataset.fx !== undefined) b.classList.toggle('sel', +b.dataset.fx === effect);
    else if (b.dataset.key !== undefined) b.classList.toggle('sel', b.dataset.key === freeKey);
  }
}
function applyTool() { if (viewer) viewer.tool = mode === 'free' ? tool : 'fill'; }
function getBrush() {
  if (mode !== 'free' || tool !== 'brush') return null;
  return { z: BRUSH_SIZES[brushIdx], e: effect, c: freeColor };
}
function animPref() {
  let v = null;
  try { v = localStorage.getItem('anim'); } catch { /* нет хранилища */ }
  if (v === '0') return false;
  if (v === '1') return true;
  return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); // по умолчанию уважаем настройку «меньше движения»
}
function syncAnimBtn() { const b = $('z-anim'); b.setAttribute('aria-pressed', String(animPref())); b.style.opacity = animPref() ? '1' : '.55'; }
const newSeed = () => (Math.random() * 2147483647) | 0;
function markNumSel() {
  for (const b of el.palette.children) b.classList.toggle('sel', +b.dataset.n === numSel);
}
function updateNumCounts() {
  if (mode !== 'num') return;
  const left = remainingByColor();
  for (const b of el.palette.children) {
    const n = +b.dataset.n;
    b.classList.toggle('done', left[n] === 0);
    b.querySelector('.left').textContent = left[n] === 0 ? '✓' : left[n];
  }
}

// ---------- действия ----------
function updateUI() {
  if (!session) return;
  el.undo.disabled = !session.canUndo();
  el.redo.disabled = !session.canRedo();
  el.pct.textContent = session.percent() + '%';
  el.hint.disabled = mode !== 'num';
  el.modeFree.classList.toggle('on', mode === 'free');
  el.modeNum.classList.toggle('on', mode === 'num');
}

function afterChange() {
  updateUI();
  updateNumCounts();
  scheduleSave();
}

function onTap(r) {
  if (!session) return;
  if (mode === 'free') {
    const st = session.fill(r, freeColor, effect, effect ? newSeed() : 0);
    if (st) { viewer.syncRegion(r); afterChange(); checkDone(); }
    return;
  }
  // режим «по цифрам»
  const need = pic.regions.color[r];
  const good = NUM_COLORS[need - 1].rgb;
  if (session.cur[r] === good) return;
  if (!numSel) { toast('Сначала выбери цвет справа'); return; }
  if (numSel !== need) {
    if (navigator.vibrate) navigator.vibrate([70, 40, 70]);
    el.host.classList.remove('shake'); void el.host.offsetWidth; el.host.classList.add('shake');
    viewer.flash(r, 'wrong');
    toast(`Здесь не цвет ${numSel}. Попробуй другой номер`);
    return;
  }
  if (session.fill(r, good, 0, 0)) {
    viewer.syncRegion(r);
    afterChange();
    checkDone();
  }
}

/** Мазок кистью уже нарисован на слое краски — записываем его как шаг. */
function onStroke(st) {
  if (!session) return;
  session.addStroke(st);
  lastDot = st.p.length === 2 ? performance.now() : 0;
  afterChange();
  checkDone();
}
/** Двойное нажатие кистью: первая точка была случайной — убираем её без возможности повтора. */
function onDoubleTap() {
  if (!session || !lastDot || performance.now() - lastDot > 700) return;
  const l = session.lastStep();
  if (l && l.k === 's' && l.p.length === 2) {
    session.undo(); session.redoStack.length = 0;
    viewer.syncRegion(l.r);
    afterChange();
  }
  lastDot = 0;
}

let doneShownFor = '';
function checkDone() {
  const done = session.percent() >= 100;
  if (done && doneShownFor !== curId) { doneShownFor = curId; toast('Готово! Молодец! 🎉', 3200); }
  if (!done && doneShownFor === curId) doneShownFor = '';
}

function undo() {
  const st = session && session.undo();
  if (!st) return;
  viewer.syncRegion(st.r);
  afterChange();
}
function redo() {
  const st = session && session.redo();
  if (!st) return;
  viewer.syncRegion(st.r);
  afterChange();
}

function setMode(m) {
  if (m === mode && session) { updateUI(); return; }
  mode = m;
  if (viewer) { viewer.setMode(m); applyTool(); }
  if (m === 'num' && session && !numSel) numSel = nextColorWithWork() || 0;
  if (session) buildPalette();
  updateUI();
}

function hint() {
  if (mode !== 'num' || !session) { toast('Подсказка работает в режиме «По цифрам»'); return; }
  const R = pic.regions;
  let n = numSel;
  if (!n) n = nextColorWithWork();
  if (!n) { toast('Всё закрашено!'); return; }
  const list = [];
  for (let r = 1; r <= R.count; r++) if (session.cur[r] < 0 && R.color[r] === n) list.push(r);
  if (!list.length) { toast(`Все области цвета ${n} закрашены. Выбери другой номер`); return; }
  const next = list.find((r) => r > hintLast) || list[0];
  hintLast = next;
  numSel = n; markNumSel();
  viewer.focusRegion(next);
  viewer.flash(next, 'hint');
}

// ---------- копия всех работ ----------
async function exportAll() {
  await flushSave();
  const prog = await db.allProgress();
  const items = {};
  for (const p of prog) items[p.id] = { algo: p.algo, fmt: p.fmt || 1, steps: p.steps, percent: p.percent, updated: p.updated };
  const data = { app: 'raskraska', format: 2, algo: ALGO, exported: new Date().toISOString(), items };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `raskraski-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Копия сохранена: работ ${Object.keys(items).length}`);
  return data;
}

async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Это не файл копии'); return; }
  if (!data || data.app !== 'raskraska' || !data.items) { toast('Это не файл копии'); return; }
  const ids = Object.keys(data.items).filter((id) => CATALOG.some((e) => e.id === id));
  if (!ids.length) { toast('В файле нет работ'); return; }
  if (!(await confirmDialog('Загрузить копию?', `Работ в файле: ${ids.length}. Текущие работы с теми же картинками будут заменены.`, 'Загрузить'))) return;
  let ok = 0, skipped = 0;
  for (const id of ids) {
    const it = data.items[id];
    if ((it.algo ?? data.algo) !== ALGO || !Array.isArray(it.steps)) { skipped++; continue; }
    await db.putProgress({ id, algo: ALGO, fmt: 2, steps: normalizeSteps(it.steps), percent: it.percent || 0, updated: it.updated || Date.now(), thumb: null });
    ok++;
  }
  await renderGallery();
  toast(skipped ? `Загружено ${ok}, пропущено ${skipped} (старая версия)` : `Загружено работ: ${ok}`);
  return { ok, skipped };
}

// ---------- привязка событий ----------
$('btn-back').onclick = () => { location.hash = ''; };
el.undo.onclick = undo;
el.redo.onclick = redo;
el.hint.onclick = hint;
el.modeFree.onclick = () => setMode('free');
el.modeNum.onclick = () => setMode('num');
$('btn-clear').onclick = async () => {
  if (!session || !session.steps.length) { toast('Тут пока нечего очищать'); return; }
  if (await confirmDialog('Очистить картинку?', 'Вся раскраска этой картинки сотрётся. Отменить это будет нельзя.', 'Очистить')) {
    session.clear(); viewer.refreshAll(); afterChange();
  }
};
$('z-in').onclick = () => viewer && viewer.zoomBy(1.5);
$('z-out').onclick = () => viewer && viewer.zoomBy(1 / 1.5);
$('z-fit').onclick = () => viewer && viewer.resetView(true);
$('z-anim').onclick = () => {
  const on = !animPref();
  try { localStorage.setItem('anim', on ? '1' : '0'); } catch { /* нет хранилища — не страшно */ }
  if (viewer) viewer.setAnimate(on);
  syncAnimBtn();
  toast(on ? 'Анимация красок включена' : 'Анимация красок выключена', 1200);
};
$('btn-export').onclick = () => exportAll().catch((e) => { console.error(e); toast('Не получилось сохранить копию'); });
$('btn-import').onclick = () => $('file-import').click();
$('file-import').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importFile(f).catch((err) => { console.error(err); toast('Не получилось загрузить копию'); });
};
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', () => { flushSave(); });
window.addEventListener('keydown', (e) => {
  if (el.paint.hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
});

// ---------- старт: офлайн и хранилище ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => { el.badge.hidden = false; }).catch((e) => console.warn('SW', e));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

route();

// Для автотестов и отладки
window.__app = {
  CATALOG, ALGO,
  get session() { return session; },
  get viewer() { return viewer; },
  get pic() { return pic; },
  get mode() { return mode; },
  get numSel() { return numSel; },
  loadPicture, openPicture: (id) => { location.hash = '#' + id; },
  exportAll, importFile, setMode, hint, undo, redo, notifyChange: afterChange,
  get tool() { return tool; }, get effect() { return effect; },
  setTool: (t, i) => { tool = t; if (i != null) brushIdx = i; applyTool(); markFreeSel(); },
  setEffect: (e) => { effect = e; markFreeSel(); },
  selectNum: (n) => { numSel = n; markNumSel(); },
  selectFree: (rgb) => { freeColor = rgb; freeKey = ''; markFreeSel(); },
  flushSave,
  screenOfRegion(r) {
    const rect = el.cv.getBoundingClientRect();
    const R = pic.regions;
    return { x: rect.left + R.lx[r] * viewer.s + viewer.tx, y: rect.top + R.ly[r] * viewer.s + viewer.ty };
  },
};
