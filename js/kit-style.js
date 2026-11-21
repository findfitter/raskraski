// Вариант «набор»: пастельные палитры по 10 баночек, автоматическая раскраска областей «как задумал художник»,
// цветные контуры и предпросмотр готовой картинки.
//
// Роли цветов в палитре (индекс 0..9 → номер баночки 1..10):
// 0 фон, 1-4 основные, 5 светлый, 6 кремовый/белый, 7 акцент, 8 тёмный, 9 блёстки.
import { KIT } from './kit-data.js';
import { EFFECTS } from './effects.js';

const P = (name, line, list) => ({ name, line, colors: list });

export const THEMES = {
  rose: P('Нежная роза', '#5C3B38', [
    ['Бледно-розовый', '#F7D9E0'], ['Розовый', '#EE9FB6'], ['Шалфей', '#CFDACB'], ['Серо-зелёный', '#7F9E92'],
    ['Карамель', '#C98F63'], ['Песочный', '#EBCDA6'], ['Сливочный', '#FFF4E6'], ['Малина', '#C8607F'],
    ['Шоколад', '#5C3B38'], ['Розовые блёстки', '#F6B8D2'],
  ]),
  mint: P('Мята и лимон', '#2F4A44', [
    ['Светлая мята', '#DDF1E6'], ['Мятный', '#7CC9A0'], ['Небесный', '#BFE3F0'], ['Изумруд', '#3E8F73'],
    ['Лимонный', '#F4D06F'], ['Салатовый', '#A8DDB5'], ['Сливочный', '#FFFBEA'], ['Коралл', '#F28B82'],
    ['Тёмная хвоя', '#2F4A44'], ['Мятные блёстки', '#BDF0E0'],
  ]),
  sunny: P('Солнечный день', '#5B3A2A', [
    ['Светлый крем', '#FFF0C9'], ['Янтарный', '#F6B84B'], ['Медовый', '#FBD98D'], ['Охра', '#C8873A'],
    ['Мятный', '#8FC9A0'], ['Голубой', '#BFE0F2'], ['Молочный', '#FFFDF4'], ['Апельсин', '#EE7B5C'],
    ['Какао', '#5B3A2A'], ['Золотые блёстки', '#FFD76A'],
  ]),
  lavender: P('Лаванда', '#40305F', [
    ['Бледная лаванда', '#E7DDF5'], ['Сирень', '#B79BE0'], ['Розовый', '#F4C6DC'], ['Фиолетовый', '#6F5AA8'],
    ['Персик', '#F7D7A8'], ['Голубой', '#CFE5F5'], ['Молочный', '#FFF7FB'], ['Орхидея', '#E36FA0'],
    ['Чернильный', '#40305F'], ['Сиреневые блёстки', '#E6CCFF'],
  ]),
  ocean: P('Морской бриз', '#27415A', [
    ['Светло-голубой', '#D9EEF8'], ['Лазурный', '#6FB7DC'], ['Бирюзовый', '#B7E0EA'], ['Морской', '#2F6E96'],
    ['Песочный', '#F2C98D'], ['Аквамарин', '#A9D8C8'], ['Белый', '#FBFDFE'], ['Коралл', '#F0806E'],
    ['Глубокий синий', '#27415A'], ['Голубые блёстки', '#BFE9FF'],
  ]),
  garden: P('Огород', '#3E3A2B', [
    ['Светлый крем', '#FFF3D6'], ['Зелёный', '#8BC66B'], ['Персиковый', '#F4A58A'], ['Лесной', '#4C8C4A'],
    ['Томатный', '#E85D4A'], ['Салатовый', '#CDE8A8'], ['Молочный', '#FFFDF2'], ['Жёлтый', '#F6C453'],
    ['Корица', '#3E3A2B'], ['Золотые блёстки', '#FFE8A0'],
  ]),
};

/** Какая палитра подходит какой картинке. */
export const THEME_OF = {
  p01: 'sunny', p02: 'garden', p03: 'rose', p04: 'mint', p05: 'rose',
  p06: 'lavender', p07: 'sunny', p08: 'ocean', p09: 'garden', p10: 'ocean',
};

export const rgbOf = (hex) => parseInt(hex.slice(1), 16);
export const KIT_OPTS = { minAreaFrac: 0.00015 };   // мельче сливаем реже: больше областей
export const KIT_VARIANT = 'kit1';

/** Палитра темы в виде [{n, name, hex, rgb, glitter}] */
export function potsOf(themeKey) {
  return THEMES[themeKey].colors.map(([name, hex], i) => ({ n: i + 1, name, hex, rgb: rgbOf(hex), glitter: i === 9 }));
}

/** Описание баночки из данных: [название, цвет, эффект?] */
const potFrom = (row, i) => ({ n: i + 1, name: row[0], hex: row[1], rgb: rgbOf(row[1]), effect: row[2] || 0, glitter: (row[2] || 0) === 1 });

/**
 * Номера баночек для областей картинки: вручную подобранные цвета (kit-data.js) или, если данные не подходят
 * к найденным областям, автоматическая раскраска по теме.
 */
export function kitFor(id, regions) {
  const d = KIT[id];
  const counts = new Int32Array(11);
  if (d && d.map.length === regions.count) {
    const color = new Uint8Array(regions.count + 1);
    d.map.forEach((v, i) => { color[i + 1] = v; counts[v]++; });
    return { color, counts, pots: d.pots.map(potFrom), line: d.line, source: 'manual' };
  }
  const themeKey = THEME_OF[id] || 'rose';
  const { color, counts: c2 } = colorize(regions);
  return { color, counts: c2, pots: potsOf(themeKey), line: THEMES[themeKey].line, source: themeKey };
}

export const fxKey = (e) => (EFFECTS.find((f) => f.id === e) || { key: 'plain' }).key;

/** Перекрасить чёрные линии в цвет темы (серый → смесь белого и цвета линий). */
export function tintLines(canvas, hex) {
  const lc = rgbOf(hex);
  const R = (lc >> 16) & 255, G = (lc >> 8) & 255, B = lc & 255;
  const x = canvas.getContext('2d');
  const img = x.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const t = 1 - ((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8) / 255;
    d[i] = 255 - t * (255 - R); d[i + 1] = 255 - t * (255 - G); d[i + 2] = 255 - t * (255 - B);
  }
  x.putImageData(img, 0, 0);
}

/**
 * Назначить областям номера баночек (1..10) так, чтобы получилась гармоничная картинка:
 * фон — самый светлый цвет, крупные области — основные цвета, мелкие внутри — кремовый/тёмный/акцент,
 * соседи не одного цвета, пара блёсточных областей. → { color: Uint8Array, counts: Int32Array(11) }
 */
export function colorize(regions) {
  const { w, h, map, count: K, area } = regions;
  const total = w * h;
  const adj = Array.from({ length: K + 1 }, () => new Set());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x, a = map[p];
      if (!a) continue;
      if (x < w - 1) { const b = map[p + 1]; if (b && b !== a) { adj[a].add(b); adj[b].add(a); } }
      if (y < h - 1) { const b = map[p + w]; if (b && b !== a) { adj[a].add(b); adj[b].add(a); } }
    }
  }
  const BG = 1, M1 = 2, M2 = 3, M3 = 4, M4 = 5, L1 = 6, SOFT = 7, ACC = 8, DARK = 9, GL = 10;
  const order = Array.from({ length: K }, (_, i) => i + 1).sort((a, b) => area[b] - area[a] || a - b);
  const color = new Uint8Array(K + 1);
  const used = new Float64Array(11);
  const bg = order[0];
  color[bg] = BG; used[BG] += area[bg];
  for (const r of order.slice(1)) {
    const a = area[r] / total;
    const enclosed = adj[r].size <= 2;
    const cands = a >= 0.02 ? [M1, M2, M4, M3, L1]
      : a >= 0.004 ? [M1, M3, M4, ACC, L1, M2, SOFT]
        : enclosed ? [SOFT, DARK, ACC, M3, L1] : [ACC, SOFT, L1, M3, M1];
    const forb = new Set();
    for (const n of adj[r]) if (color[n]) forb.add(color[n]);
    const jit = ((r * 2654435761) >>> 0) % 3;
    let pick = 0, best = Infinity;
    cands.forEach((c, idx) => {
      if (forb.has(c)) return;
      const s = used[c] + idx * total * 0.012 + ((idx + jit) % 3) * total * 0.003;
      if (s < best) { best = s; pick = c; }
    });
    if (!pick) for (let c = M1; c <= DARK; c++) if (!forb.has(c) && used[c] < best) { best = used[c]; pick = c; }
    if (!pick) pick = M1;
    color[r] = pick; used[pick] += area[r];
  }
  // блёсточные области: 2-3 небольшие, не соседние
  const glit = [];
  const pool = order.slice(1).filter((r) => { const a = area[r] / total; return a >= 0.0012 && a < 0.035 && color[r] !== DARK && color[r] !== SOFT; });
  for (const r of pool) {
    if (glit.length >= 3) break;
    if ([...adj[r]].some((n) => color[n] === GL)) continue;
    color[r] = GL; glit.push(r);
  }
  // чтобы в наборе были все основные цвета
  const counts = () => { const c = new Int32Array(11); for (let r = 1; r <= K; r++) c[color[r]]++; return c; };
  let cnt = counts();
  for (const role of [DARK, SOFT, ACC, M3, L1, M4, M2]) {
    if (cnt[role] > 0) continue;
    let pick = 0, pa = Infinity;
    for (let r = 1; r <= K; r++) {
      if (r === bg || color[r] === GL || cnt[color[r]] < 2) continue;
      if ([...adj[r]].some((n) => color[n] === role)) continue;
      if (area[r] / total > 0.03 || area[r] >= pa) continue;
      pa = area[r]; pick = r;
    }
    if (pick) { cnt[color[pick]]--; color[pick] = role; cnt[role]++; }
  }
  cnt = counts();
  return { color, counts: cnt };
}

/** Готовая картинка («как на коробке») для плитки галереи. */
export function renderPreview(pic, color, pots, width = 420) {
  const { w, h, lineCanvas, regions } = pic;
  const k = width / w;
  const cw = Math.round(width), ch = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const x = c.getContext('2d');
  const id = x.createImageData(cw, ch), d = id.data;
  for (let yy = 0; yy < ch; yy++) {
    const sy = Math.min(h - 1, Math.floor(yy / k));
    for (let xx = 0; xx < cw; xx++) {
      const sx = Math.min(w - 1, Math.floor(xx / k));
      const r = regions.map[sy * w + sx];
      const v = r ? pots[color[r] - 1].rgb : 0xffffff;
      const o = (yy * cw + xx) * 4;
      d[o] = (v >> 16) & 255; d[o + 1] = (v >> 8) & 255; d[o + 2] = v & 255; d[o + 3] = 255;
    }
  }
  x.putImageData(id, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.imageSmoothingQuality = 'high';
  x.drawImage(lineCanvas, 0, 0, cw, ch);
  return c;
}
