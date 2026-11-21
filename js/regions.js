// Расчёт областей раскраски. Чистые функции, без DOM: работает и в Web Worker, и в основном потоке.
// Вход: карта яркости (Uint8Array w*h, 0 = чёрный, 255 = белый).
// Выход: карта областей Uint16Array (номер области на каждый пиксель, 0 = «ничья» зона)
// и метаданные областей (площадь, рамка, точка для номера, цвет по номерам).

export const ALGO = 2; // версия алгоритма: при смене карты областей кэш и сохранения считаются устаревшими
export const NCOLORS = 14; // число цветов в режиме «по цифрам»

const DEFAULTS = {
  threshold: 150, // пиксель темнее порога = линия
  closeRadius: 2, // закрытие щелей в линиях: закрываются щели до ~2*r пикселей
  speck: 12, // компоненты меньше этого числа пикселей считаются шумом JPEG
  minAreaFrac: 0.0005, // области меньше 0,05% площади сливаются с соседями
  expand: 6, // насколько заливка/нажатие «заходит» под линию (пикселей)
};

// ---------- морфология ----------

// Расширение (dilate) квадратным элементом (2r+1) за два линейных прохода.
function dilate(src, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let cnt = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) cnt += src[row + x];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = cnt > 0 ? 1 : 0;
      const add = x + r + 1;
      if (add < w) cnt += src[row + add];
      const rem = x - r;
      if (rem >= 0) cnt -= src[row + rem];
    }
  }
  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) cnt += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = cnt > 0 ? 1 : 0;
      const add = y + r + 1;
      if (add < h) cnt += tmp[add * w + x];
      const rem = y - r;
      if (rem >= 0) cnt -= tmp[rem * w + x];
    }
  }
  return out;
}

// Морфологическое закрытие линий: dilate, затем erode (erode(a) = !dilate(!a), за границей кадра линий нет).
function closeLines(mask, w, h, r) {
  if (r <= 0) return mask;
  const d = dilate(mask, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] ^= 1;
  const e = dilate(d, w, h, r);
  for (let i = 0; i < e.length; i++) e[i] ^= 1;
  return e;
}

// ---------- точное евклидово преобразование расстояний (Felzenszwalb) ----------

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e30;
  z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k]) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

// Квадрат расстояния от каждого «внутреннего» пикселя до ближайшего «не внутреннего» (рамка кадра тоже считается стеной).
function edtSquared(inside, w, h) {
  const INF = 1e9;
  const out = new Float32Array(w * h);
  const n = Math.max(w, h) + 2;
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    f[0] = 0;
    for (let y = 0; y < h; y++) f[y + 1] = inside[y * w + x] ? INF : 0;
    f[h + 1] = 0;
    edt1d(f, h + 2, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y + 1];
  }
  for (let y = 0; y < h; y++) {
    f[0] = 0;
    for (let x = 0; x < w; x++) f[x + 1] = out[y * w + x];
    f[w + 1] = 0;
    edt1d(f, w + 2, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x + 1];
  }
  return out;
}

// ---------- основной расчёт ----------

export function computeRegions(gray, w, h, options = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const o = { ...DEFAULTS, ...options };
  const N = w * h;

  // 1. Бинаризация: линия = тёмный пиксель
  let mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = gray[i] < o.threshold ? 1 : 0;

  // 2. Закрываем щели в линиях
  mask = closeLines(mask, w, h, o.closeRadius);

  // 3. Связные области (4-связность) заливкой по очереди
  const lab = new Int32Array(N);
  const queue = new Int32Array(N);
  const areaRaw = [0];
  let n = 0;
  let specks = 0;
  for (let s = 0; s < N; s++) {
    if (mask[s] || lab[s]) continue;
    n++;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    lab[s] = n;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      if (x > 0 && !mask[p - 1] && !lab[p - 1]) { lab[p - 1] = n; queue[tail++] = p - 1; }
      if (x < w - 1 && !mask[p + 1] && !lab[p + 1]) { lab[p + 1] = n; queue[tail++] = p + 1; }
      if (p >= w && !mask[p - w] && !lab[p - w]) { lab[p - w] = n; queue[tail++] = p - w; }
      if (p < N - w && !mask[p + w] && !lab[p + w]) { lab[p + w] = n; queue[tail++] = p + w; }
    }
    if (tail < o.speck) {
      for (let k = 0; k < tail; k++) { mask[queue[k]] = 1; lab[queue[k]] = 0; }
      n--;
      specks++;
    } else {
      areaRaw[n] = tail;
    }
  }
  const raw = n;

  // 4. «Заход» областей под линии на expand пикселей: нужно, чтобы заливка шла под линию
  //    и чтобы палец, попавший на линию, выбирал ближайшую область.
  const E = lab.slice();
  {
    let cur = queue; // переиспользуем память очереди
    let nxt = new Int32Array(N);
    let cn = 0;
    for (let p = 0; p < N; p++) {
      if (!E[p]) continue;
      const x = p % w;
      if ((x > 0 && !E[p - 1]) || (x < w - 1 && !E[p + 1]) || (p >= w && !E[p - w]) || (p < N - w && !E[p + w])) cur[cn++] = p;
    }
    for (let it = 0; it < o.expand && cn > 0; it++) {
      let nn = 0;
      for (let i = 0; i < cn; i++) {
        const p = cur[i];
        const L = E[p];
        const x = p % w;
        let q;
        if (x > 0 && !E[(q = p - 1)]) { E[q] = L; nxt[nn++] = q; }
        if (x < w - 1 && !E[(q = p + 1)]) { E[q] = L; nxt[nn++] = q; }
        if (p >= w && !E[(q = p - w)]) { E[q] = L; nxt[nn++] = q; }
        if (p < N - w && !E[(q = p + w)]) { E[q] = L; nxt[nn++] = q; }
      }
      const t = cur; cur = nxt; nxt = t;
      cn = nn;
    }
  }

  // 5. Соседство областей (по длине общей границы)
  const nb = new Array(raw + 1);
  for (let i = 0; i <= raw; i++) nb[i] = new Map();
  const link = (a, b) => {
    if (a === b || !a || !b) return;
    nb[a].set(b, (nb[a].get(b) || 0) + 1);
    nb[b].set(a, (nb[b].get(a) || 0) + 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = E[p];
      if (!a) continue;
      if (x < w - 1) link(a, E[p + 1]);
      if (y < h - 1) link(a, E[p + w]);
    }
  }

  // 6. Слияние мелких областей с соседом, с которым самая длинная общая граница
  const minArea = Math.max(1, Math.round(o.minAreaFrac * N));
  const parent = new Int32Array(raw + 1);
  for (let i = 0; i <= raw; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const area = Float64Array.from(areaRaw);
  const dropped = new Uint8Array(raw + 1);
  let merged = 0;
  let droppedCount = 0;
  const order = [];
  for (let i = 1; i <= raw; i++) if (area[i] < minArea) order.push(i);
  order.sort((a, b) => area[a] - area[b] || a - b);
  for (const a0 of order) {
    const a = find(a0);
    if (a !== a0 || area[a] >= minArea || dropped[a]) continue;
    let best = 0;
    let bestC = 0;
    for (const [c, cnt] of nb[a]) {
      if (cnt > bestC || (cnt === bestC && c < best)) { best = c; bestC = cnt; }
    }
    if (!best) {
      dropped[a] = 1;
      droppedCount++;
      continue;
    }
    // a вливается в best
    for (const [c, cnt] of nb[a]) {
      nb[c].delete(a);
      if (c === best) continue;
      nb[c].set(best, (nb[c].get(best) || 0) + cnt);
      nb[best].set(c, (nb[best].get(c) || 0) + cnt);
    }
    nb[a].clear();
    parent[a] = best;
    area[best] += area[a];
    merged++;
  }

  // 7. Итоговая нумерация 1..K в порядке растрового обхода и карта Uint16
  const newId = new Int32Array(raw + 1);
  const map = new Uint16Array(N);
  let K = 0;
  for (let p = 0; p < N; p++) {
    const l = E[p];
    if (!l) continue;
    const r = find(l);
    if (dropped[r]) continue;
    if (!newId[r]) {
      if (K >= 65535) throw new Error('Слишком много областей');
      newId[r] = ++K;
    }
    map[p] = newId[r];
  }

  // 8. Площадь, рамки, точка для номера (самая крупная внутренняя точка = максимум расстояния до линии)
  const areaF = new Int32Array(K + 1);
  const bbox = new Int32Array((K + 1) * 4);
  for (let r = 1; r <= K; r++) { bbox[r * 4] = w; bbox[r * 4 + 1] = h; bbox[r * 4 + 2] = -1; bbox[r * 4 + 3] = -1; }
  const inside = new Uint8Array(N);
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const r = map[p];
      if (!r) continue;
      areaF[r]++;
      const b = r * 4;
      if (x < bbox[b]) bbox[b] = x;
      if (y < bbox[b + 1]) bbox[b + 1] = y;
      if (x > bbox[b + 2]) bbox[b + 2] = x;
      if (y > bbox[b + 3]) bbox[b + 3] = y;
      if (lab[p]) inside[p] = 1; // только «ядро» области, без захода под линию
    }
  }
  const d2 = edtSquared(inside, w, h);
  const best = new Float32Array(K + 1);
  for (let p = 0; p < N; p++) {
    if (!inside[p]) continue;
    const r = map[p];
    if (d2[p] > best[r]) best[r] = d2[p];
  }
  // среди пикселей «плато» около максимума берём ближайший к их центру масс
  const sx = new Float64Array(K + 1);
  const sy = new Float64Array(K + 1);
  const sc = new Float64Array(K + 1);
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      if (!inside[p]) continue;
      const r = map[p];
      if (d2[p] >= best[r] * 0.85) { sx[r] += x; sy[r] += y; sc[r]++; }
    }
  }
  const lx = new Int16Array(K + 1);
  const ly = new Int16Array(K + 1);
  const lr = new Float32Array(K + 1);
  const bestDist = new Float64Array(K + 1).fill(1e30);
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      if (!inside[p]) continue;
      const r = map[p];
      if (d2[p] < best[r] * 0.85) continue;
      const dx = x - sx[r] / sc[r];
      const dy = y - sy[r] / sc[r];
      const dd = dx * dx + dy * dy;
      if (dd < bestDist[r]) { bestDist[r] = dd; lx[r] = x; ly[r] = y; }
    }
  }
  for (let r = 1; r <= K; r++) lr[r] = Math.sqrt(best[r]);
  // области без «ядра» (бывает, если ядро целиком влилось) — центр рамки
  for (let r = 1; r <= K; r++) {
    if (sc[r] === 0) {
      lx[r] = (bbox[r * 4] + bbox[r * 4 + 2]) >> 1;
      ly[r] = (bbox[r * 4 + 1] + bbox[r * 4 + 3]) >> 1;
      lr[r] = 1;
    }
  }

  const color = assignColors(map, w, h, K, areaF);

  const now = (typeof performance !== 'undefined' ? performance : Date).now();
  return {
    algo: ALGO, w, h, count: K, map, area: areaF, bbox, lx, ly, lr, color,
    stats: { raw, specks, merged, dropped: droppedCount, minArea, ms: Math.round(now - t0) },
  };
}

// ---------- цвета «по цифрам» ----------
// Исходные картинки чёрно-белые, цветов в них нет, поэтому цвета назначаются автоматически:
// соседние области получают разные цвета, цвета распределяются по площади равномерно.
function assignColors(map, w, h, K, area) {
  const adj = Array.from({ length: K + 1 }, () => new Set());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = map[p];
      if (!a) continue;
      if (x < w - 1) { const b = map[p + 1]; if (b && b !== a) { adj[a].add(b); adj[b].add(a); } }
      if (y < h - 1) { const b = map[p + w]; if (b && b !== a) { adj[a].add(b); adj[b].add(a); } }
    }
  }
  const order = [];
  for (let r = 1; r <= K; r++) order.push(r);
  order.sort((a, b) => area[b] - area[a] || a - b);
  const color = new Uint8Array(K + 1);
  const used = new Float64Array(NCOLORS + 1);
  for (const r of order) {
    const forbidden = new Uint8Array(NCOLORS + 1);
    for (const nbr of adj[r]) if (color[nbr]) forbidden[color[nbr]] = 1;
    let pick = 0;
    let bestScore = Infinity;
    const jitter = ((r * 2654435761) >>> 0) % NCOLORS;
    for (let k = 0; k < NCOLORS; k++) {
      const c = ((k + jitter) % NCOLORS) + 1;
      if (forbidden[c]) continue;
      if (used[c] < bestScore) { bestScore = used[c]; pick = c; }
    }
    if (!pick) pick = (r % NCOLORS) + 1;
    color[r] = pick;
    used[pick] += area[r];
  }
  return color;
}
