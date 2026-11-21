// Вариант «набор»: рисуем кистью по номерам, 10 баночек с краской, рамка, цветные контуры.
import { CATALOG } from './catalog.js';
import { ALGO } from './regions.js';
import { Session, normalizeSteps } from './paint.js';
import { Viewer } from './viewer.js';
import { loadPicture } from './loader.js';
import { KIT_OPTS, KIT_VARIANT, kitFor, fxKey, tintLines, renderPreview } from './kit-style.js';
import { KIT } from './kit-data.js';
import * as db from './db.js';

const $ = (id) => document.getElementById(id);
const el = {
  gallery: $('gallery'), grid: $('grid'), paint: $('paint'), host: $('host'), cv: $('cv'), palette: $('palette'),
  loading: $('loading'), loadingText: $('loading-text'), pct: $('pct'), toast: $('toast'),
  undo: $('btn-undo'), redo: $('btn-redo'), hint: $('btn-hint'), badge: $('offline-badge'),
};
const KEY = (id) => 'c-' + id;
const SIZES = [14, 28, 52];        // диаметры кистей (px картинки)
const FRAME = 38;                  // ширина рамки (px картинки)

let viewer = null, session = null, pic = null, curId = null, openToken = 0;
let tool = 'b1';                   // 'b0'..'b2' — кисти, 'fill' — залить область
let numSel = 0;                    // выбранная баночка
let hintLast = 0;
const previews = new Map();        // id → url готовой картинки (для плиток)

// ---------- мелочи ----------
let toastTimer = 0;
function toast(msg, ms = 1900) {
  el.toast.textContent = msg; el.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}
function confirmDialog(title, text, okLabel = 'Да') {
  return new Promise((resolve) => {
    $('modal-title').textContent = title; $('modal-text').textContent = text; $('modal-ok').textContent = okLabel;
    $('modal').hidden = false;
    const done = (v) => { $('modal').hidden = true; $('modal-ok').onclick = $('modal-cancel').onclick = null; resolve(v); };
    $('modal-ok').onclick = () => done(true); $('modal-cancel').onclick = () => done(false);
  });
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

// ---------- подготовка картинки: области, контуры цвета темы, номера баночек ----------
async function prepare(entry) {
  const p = await loadPicture(entry, { key: KEY(entry.id), opts: KIT_OPTS, variant: KIT_VARIANT });
  const k = kitFor(entry.id, p.regions);
  tintLines(p.lineCanvas, k.line);
  return { ...p, regions: { ...p.regions, color: k.color }, themeKey: k.source, counts: k.counts, pots: k.pots };
}

// ---------- галерея ----------
function clearBlobUrls() { /* превью живут, пока открыта страница */ }

async function renderGallery() {
  let prog = [];
  try { prog = await db.allProgress(); } catch (e) { console.warn(e); }
  const byId = new Map(prog.filter((p) => p.id.startsWith('c-')).map((p) => [p.id.slice(2), p]));
  el.grid.textContent = '';
  for (const e of CATALOG) {
    const p = byId.get(e.id);
    const pct = p && p.algo === ALGO ? p.percent || 0 : 0;
    const b = document.createElement('button');
    b.className = 'tile' + (pct > 0 ? ' started' : '') + (pct >= 100 ? ' done' : '');
    b.dataset.id = e.id;
    b.innerHTML = '<div class="frame"><img class="thumb wait" alt="" draggable="false"></div><div class="meta"><span class="name"></span><span class="pbadge"></span></div><div class="sub"></div><div class="bar"><i></i></div>';
    b.querySelector('.name').textContent = e.title;
    const kd = KIT[e.id];
    b.querySelector('.sub').textContent = kd ? '✨ ' + kd.pots[9][0] : '';
    b.querySelector('.pbadge').textContent = pct + '%';
    b.querySelector('.bar i').style.width = pct + '%';
    const img = b.querySelector('img');
    if (previews.has(e.id)) { img.src = previews.get(e.id); img.classList.remove('wait'); }
    b.addEventListener('click', () => { location.hash = '#' + e.id; });
    el.grid.appendChild(b);
  }
  fillPreviews();
}

let previewRun = 0;
async function fillPreviews() {
  const run = ++previewRun;
  for (const e of CATALOG) {
    if (run !== previewRun || previews.has(e.id)) continue;
    try {
      const p = await prepare(e);
      const c = renderPreview(p, p.regions.color, p.pots, 420);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
      const url = URL.createObjectURL(blob);
      previews.set(e.id, url);
      const img = el.grid.querySelector(`.tile[data-id="${e.id}"] img`);
      if (img) { img.src = url; img.classList.remove('wait'); }
    } catch (err) { console.warn('превью', e.id, err); }
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
  if (curId) await flushSave();
  curId = null; session = null; pic = null;
  el.paint.hidden = true; el.gallery.hidden = false;
  await renderGallery();
}

async function openPicture(entry) {
  const token = ++openToken;
  if (curId) await flushSave();
  curId = entry.id;
  el.gallery.hidden = true; el.paint.hidden = false; el.loading.hidden = false;
  el.loadingText.textContent = 'Готовлю картинку…';
  if (!viewer) {
    viewer = new Viewer(el.cv, el.host, { onTap, getBrush, canStroke, onStroke, onDoubleTap });
    viewer.m = FRAME; viewer.bg = '#d9d0c4'; viewer.hideCovered = true;
    viewer.animate = animPref(); syncAnimBtn();
  }
  try {
    const p = await prepare(entry);
    if (token !== openToken) return;
    let steps = [];
    const prog = await db.getProgress(KEY(entry.id)).catch(() => null);
    if (prog && prog.algo === ALGO && Array.isArray(prog.steps)) steps = normalizeSteps(prog.steps);
    pic = p;
    session = new Session(p.regions, steps);
    viewer.load(p, session);
    viewer.setMode('num');
    applyTool();
    numSel = nextColorWithWork() || 0;
    hintLast = 0;
    buildPots();
    updateUI();
  } catch (err) {
    console.error(err); toast('Не удалось открыть картинку'); location.hash = '';
  } finally {
    if (token === openToken) el.loading.hidden = true;
  }
}

// ---------- сохранение ----------
let saveTimer = 0, saveChain = Promise.resolve();
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveChain = saveChain.then(saveNow); }, 500); }
function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; saveChain = saveChain.then(saveNow); } return saveChain; }
async function saveNow() {
  saveTimer = 0;
  if (!session || !curId) return;
  const id = KEY(curId);
  try {
    if (!session.steps.length) { await db.delProgress(id); return; }
    await db.putProgress({ id, algo: ALGO, fmt: 2, kit: 1, steps: session.steps.slice(), percent: session.percent(), updated: Date.now() });
  } catch (e) { console.warn('Не удалось сохранить', e); toast('Не удалось сохранить прогресс'); }
}

// ---------- баночки ----------
function remaining() {
  const left = new Int32Array(11);
  const R = pic.regions;
  for (let r = 1; r <= R.count; r++) if (session.cur[r] < 0) left[R.color[r]]++;
  return left;
}
function nextColorWithWork() {
  const R = pic.regions;
  let best = 0, ba = -1;
  for (let r = 1; r <= R.count; r++) if (session.cur[r] < 0 && R.area[r] > ba) { ba = R.area[r]; best = R.color[r]; }
  return best;
}
function buildPots() {
  const P = el.palette;
  P.textContent = '';
  const t = document.createElement('div'); t.className = 'ttl'; t.textContent = 'Баночки'; P.appendChild(t);
  const grid = document.createElement('div'); grid.className = 'pots'; P.appendChild(grid);
  const left = remaining();
  for (const pot of pic.pots) {
    const b = document.createElement('button');
    const total = pic.counts[pot.n];
    b.className = 'pot' + (pot.effect === 1 || pot.effect === 8 ? ' glitter' : '') + (pot.effect ? ' magic fx-' + fxKey(pot.effect) : '') + (pot.n === numSel ? ' sel' : '') + (total === 0 ? ' empty' : left[pot.n] === 0 ? ' done' : '');
    b.style.setProperty('--c', pot.hex);
    b.dataset.n = pot.n; b.title = pot.name;
    b.setAttribute('aria-label', `Баночка ${pot.n}, ${pot.name}`);
    b.innerHTML = `<span class="paint"></span><span class="num">${pot.n}</span><span class="left">${left[pot.n] === 0 ? '✓' : left[pot.n]}</span>`;
    b.onclick = () => { numSel = pot.n; markPots(); };
    grid.appendChild(b);
  }
  const nm = document.createElement('div'); nm.className = 'potname'; nm.id = 'potname'; P.appendChild(nm);
  markPots();
}
function markPots() {
  for (const b of el.palette.querySelectorAll('.pot')) b.classList.toggle('sel', +b.dataset.n === numSel);
  const nm = $('potname');
  if (nm) nm.textContent = numSel ? `${numSel}. ${pic.pots[numSel - 1].name}` : '';
}
function updateCounts() {
  const left = remaining();
  for (const b of el.palette.querySelectorAll('.pot')) {
    const n = +b.dataset.n;
    if (pic.counts[n] === 0) continue;
    b.classList.toggle('done', left[n] === 0);
    b.querySelector('.left').textContent = left[n] === 0 ? '✓' : left[n];
  }
}

// ---------- инструменты ----------
function applyTool() {
  if (viewer) viewer.tool = tool === 'fill' ? 'fill' : 'brush';
  for (const b of document.querySelectorAll('.topbar .tool')) b.classList.toggle('on', b.dataset.tool === tool);
}
const potOf = (r) => pic.pots[pic.regions.color[r] - 1];

function wrong(r, need) {
  if (navigator.vibrate) navigator.vibrate([70, 40, 70]);
  el.host.classList.remove('shake'); void el.host.offsetWidth; el.host.classList.add('shake');
  viewer.flash(r, 'wrong');
  toast(`Здесь не баночка ${numSel}. Попробуй другую`);
}

/** Можно ли начать мазок в области r выбранной баночкой. */
function canStroke(r) {
  if (!session || session.cur[r] >= 0) return false;           // область уже закончена
  if (!numSel) { toast('Сначала выбери баночку справа'); return false; }
  if (potOf(r).n !== numSel) { wrong(r); return false; }
  return true;
}
function getBrush() {
  if (!session || tool === 'fill') return null;
  const pot = numSel ? pic.pots[numSel - 1] : pic.pots[0];
  return { z: SIZES[+tool.slice(1)], e: pot.effect, c: pot.rgb };
}

function finishRegion(r) {   // область закрашена: ровная заливка вместо неровных мазков
  const pot = potOf(r);
  if (session.fill(r, pot.rgb, pot.effect, pot.effect ? newSeed() : 0)) viewer.syncRegion(r);
}

function onTap(r) {          // инструмент «Заливка»
  if (!canStroke(r)) return;
  finishRegion(r);
  afterChange();
}
function onStroke(st) {
  session.addStroke(st);
  if (session.cur[st.r] < 0 && session.fraction(st.r) >= 1) finishRegion(st.r); // ≥75% покрытия → готово
  lastDot = st.p.length === 2 ? performance.now() : 0;
  afterChange();
}
let lastDot = 0;
function onDoubleTap() {
  if (!session || !lastDot || performance.now() - lastDot > 700) return;
  const l = session.lastStep();
  if (l && l.k === 's' && l.p.length === 2) { session.undo(); session.redoStack.length = 0; viewer.syncRegion(l.r); afterChange(); }
  lastDot = 0;
}

let doneFor = '';
function afterChange() {
  updateUI(); updateCounts(); scheduleSave();
  const done = session.percent() >= 100;
  if (done && doneFor !== curId) { doneFor = curId; toast('Картина готова! Какая красота! 🎉', 3500); }
  if (!done && doneFor === curId) doneFor = '';
}
function updateUI() {
  if (!session) return;
  el.undo.disabled = !session.canUndo(); el.redo.disabled = !session.canRedo();
  el.pct.textContent = session.percent() + '%';
}
function undo() { const st = session && session.undo(); if (st) { viewer.syncRegion(st.r); afterChange(); } }
function redo() { const st = session && session.redo(); if (st) { viewer.syncRegion(st.r); afterChange(); } }

function hint() {
  if (!session) return;
  const R = pic.regions;
  let n = numSel || nextColorWithWork();
  if (!n) { toast('Всё закрашено!'); return; }
  const list = [];
  for (let r = 1; r <= R.count; r++) if (session.cur[r] < 0 && R.color[r] === n) list.push(r);
  if (!list.length) { toast(`Баночка ${n} закончилась — выбери другую`); return; }
  const next = list.find((r) => r > hintLast) || list[0];
  hintLast = next; numSel = n; markPots();
  viewer.focusRegion(next); viewer.flash(next, 'hint');
}

// ---------- копия работ ----------
async function exportAll() {
  await flushSave();
  const prog = (await db.allProgress()).filter((p) => p.id.startsWith('c-'));
  const items = {};
  for (const p of prog) items[p.id.slice(2)] = { algo: p.algo, steps: p.steps, percent: p.percent, updated: p.updated };
  const data = { app: 'raskraska-kit', format: 1, algo: ALGO, variant: KIT_VARIANT, exported: new Date().toISOString(), items };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'), d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `nabor-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Копия сохранена: работ ${Object.keys(items).length}`);
}
async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Это не файл копии'); return; }
  if (!data || data.app !== 'raskraska-kit' || !data.items) { toast('Это не файл копии набора'); return; }
  const ids = Object.keys(data.items).filter((id) => CATALOG.some((e) => e.id === id));
  if (!ids.length) { toast('В файле нет работ'); return; }
  if (!(await confirmDialog('Загрузить копию?', `Работ в файле: ${ids.length}. Текущие работы с теми же картинками будут заменены.`, 'Загрузить'))) return;
  let ok = 0, skipped = 0;
  for (const id of ids) {
    const it = data.items[id];
    if ((it.algo ?? data.algo) !== ALGO || !Array.isArray(it.steps)) { skipped++; continue; }
    await db.putProgress({ id: KEY(id), algo: ALGO, fmt: 2, kit: 1, steps: normalizeSteps(it.steps), percent: it.percent || 0, updated: it.updated || Date.now() });
    ok++;
  }
  await renderGallery();
  toast(skipped ? `Загружено ${ok}, пропущено ${skipped}` : `Загружено работ: ${ok}`);
}

// ---------- события ----------
$('btn-back').onclick = () => { location.hash = ''; };
el.undo.onclick = undo; el.redo.onclick = redo; el.hint.onclick = hint;
for (const b of document.querySelectorAll('.topbar .tool')) b.onclick = () => { tool = b.dataset.tool; applyTool(); };
$('btn-clear').onclick = async () => {
  if (!session || !session.steps.length) { toast('Тут пока нечего очищать'); return; }
  if (await confirmDialog('Начать заново?', 'Вся краска на этой картинке сотрётся. Отменить это будет нельзя.', 'Стереть')) {
    session.clear(); viewer.refreshAll(); numSel = nextColorWithWork() || 0; buildPots(); afterChange();
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
$('file-import').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f).catch((err) => { console.error(err); toast('Не получилось загрузить копию'); }); };
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', () => { flushSave(); });
window.addEventListener('keydown', (e) => {
  if (el.paint.hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => { el.badge.hidden = false; }).catch((e) => console.warn('SW', e));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
route();

window.__kit = {
  prepare, CATALOG,
  get session() { return session; }, get viewer() { return viewer; }, get pic() { return pic; },
  get numSel() { return numSel; },
  selectPot: (n) => { numSel = n; markPots(); },
  setTool: (t) => { tool = t; applyTool(); },
  hint, undo, redo, exportAll, importFile, flushSave, notifyChange: afterChange,
  openPicture: (id) => { location.hash = '#' + id; },
  screenOfRegion(r) {
    const rect = el.cv.getBoundingClientRect(), R = pic.regions;
    return { x: rect.left + R.lx[r] * viewer.s + viewer.tx, y: rect.top + R.ly[r] * viewer.s + viewer.ty };
  },
};
