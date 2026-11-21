// Загрузка картинки и расчёт областей (общий код для варианта «набор»).
import { ALGO } from './regions.js';
import { MAX_SIDE } from './catalog.js';
import * as db from './db.js';

export async function decodeToCanvas(url) {
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

export function grayOf(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, k = 0; i < g.length; i++, k += 4) g[i] = (d[k] * 77 + d[k + 1] * 150 + d[k + 2] * 29) >> 8;
  return g;
}

let worker = null;
let nextId = 1;
const pending = new Map();   // id запроса → {resolve, reject}: ответы воркера не должны путаться между картинками
function getWorker() {
  if (!worker) {
    worker = new Worker('js/worker.js', { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.res); else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'worker error');
      worker = null;
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
  }
  return worker;
}
function computeInWorker(gray, w, h, opts) {
  return new Promise((resolve, reject) => {
    try {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, gray, w, h, opts }, [gray.buffer]);
    } catch (err) { reject(err); }
  });
}

export async function computeAny(gray, w, h, opts) {
  try {
    return await computeInWorker(gray, w, h, opts);
  } catch (err) {
    console.warn('Worker недоступен, считаю в основном потоке:', err);
    const { computeRegions } = await import('./regions.js');
    return computeRegions(gray, w, h, opts);
  }
}

/**
 * Картинка + карта областей. Карта кэшируется в IndexedDB под ключом key.
 * variant — строка с параметрами расчёта: при её смене кэш считается устаревшим.
 */
export async function loadPicture(entry, { key, opts = {}, variant = '' } = {}) {
  const t0 = performance.now();
  const lineCanvas = await decodeToCanvas(entry.file);
  const { width: w, height: h } = lineCanvas;
  let regions = await db.getRegions(key).catch(() => null);
  if (regions && (regions.algo !== ALGO || regions.w !== w || regions.h !== h || regions.variant !== variant)) regions = null;
  const fromCache = !!regions;
  if (!regions) {
    regions = await computeAny(grayOf(lineCanvas), w, h, opts);
    await db.putRegions({ id: key, variant, ...regions }).catch((e) => console.warn('кэш областей не записан', e));
  }
  return { id: entry.id, w, h, lineCanvas, regions, fromCache, ms: Math.round(performance.now() - t0) };
}
