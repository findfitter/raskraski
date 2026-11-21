// Эффекты («материалы») кисти и заливки: блестки, радуга, сердечки, звёзды, золото, серебро, перламутр.
// Весь рисунок детерминирован: случайность берётся из mulberry32(seed), seed хранится в шаге,
// поэтому при отмене/загрузке штрих перерисовывается точно так же.

export const EFFECTS = [
  { id: 0, key: 'plain', name: 'Обычная' },
  { id: 1, key: 'glitter', name: 'Блестки' },
  { id: 2, key: 'rainbow', name: 'Радуга' },
  { id: 3, key: 'hearts', name: 'Сердечки' },
  { id: 4, key: 'stars', name: 'Звёздочки' },
  { id: 5, key: 'gold', name: 'Золото' },
  { id: 6, key: 'silver', name: 'Серебро' },
  { id: 7, key: 'pearl', name: 'Перламутр' },
  // анимированные «волшебные» краски: на холсте живут (мерцают, переливаются, летят)
  { id: 8, key: 'twinkle', name: 'Мерцающие блёстки', anim: true },
  { id: 9, key: 'rainflow', name: 'Радужный перелив', anim: true },
  { id: 10, key: 'galaxy', name: 'Галактика', anim: true },
  { id: 11, key: 'pearlflow', name: 'Жемчужный перелив', anim: true },
  { id: 12, key: 'flyhearts', name: 'Летящие сердечки', anim: true },
];
export const isAnimated = (e) => e >= 8;
/** Эффекты со своим собственным цветом: выбор обычного цвета отключает их (радуга, золото, серебро, перламутр, галактика…). */
export const SELF_COLORED = new Set([2, 5, 6, 7, 9, 10, 11]);
export const BRUSH_SIZES = [6, 14, 28, 52]; // диаметр кисти в пикселях картинки

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const css = (rgb) => '#' + (rgb >>> 0).toString(16).padStart(6, '0');
export function mix(a, b, k) { // k=0 → a, k=1 → b
  const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
  const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
  const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
  return (r << 16) | (g << 8) | bl;
}

/** Цвет «подложки» заливки области (слой цветов): под узором он и виден, и считается как «закрашено». */
export function baseColor(e, rgb) {
  switch (e) {
    case 1: return rgb;
    case 2: return 0xffd6e8;
    case 3: case 4: return mix(rgb, 0xffffff, 0.78);
    case 5: return 0xe3b84a;
    case 6: return 0xc9ced6;
    case 7: return 0xf1e4f6;
    case 8: return rgb;
    case 9: return 0xffd6e8;
    case 10: return 0x3a2a6b;
    case 11: return 0xf1e4f6;
    case 12: return mix(rgb, 0xffffff, 0.7);
    default: return rgb;
  }
}

// ---- узоры (диагональные полосы) для золота, серебра, перламутра и радуги ----
const STOPS = {
  rainbow: ['#ff3b3b', '#ff9a1f', '#ffe135', '#4cd964', '#35c8ff', '#6b5bff', '#c453ff', '#ff3b3b'],
  gold: ['#9a7418', '#e8c25a', '#fff1a8', '#e8c25a', '#9a7418'],
  silver: ['#8d949e', '#dfe3e8', '#ffffff', '#dfe3e8', '#8d949e'],
  pearl: ['#ffd1e8', '#d8c8ff', '#c4f0ff', '#d4ffe8', '#fff3c4', '#ffd1e8'],
};
const ANGLE = { rainbow: 28, gold: 35, silver: 35, pearl: 60 };
const PERIOD = { rainbow: 220, gold: 150, silver: 150, pearl: 260 };
const tiles = {};
function tile(key) {
  if (tiles[key]) return tiles[key];
  const c = document.createElement('canvas');
  c.width = PERIOD[key]; c.height = 8;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, c.width, 0);
  STOPS[key].forEach((s, i, a) => gr.addColorStop(i / (a.length - 1), s));
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, 8);
  return (tiles[key] = c);
}
export function patternFor(ctx, key) {
  const p = ctx.createPattern(tile(key), 'repeat');
  if (p.setTransform) p.setTransform(new DOMMatrix().rotate(ANGLE[key]));
  return p;
}
export const isPatternEffect = (e) => e === 2 || e === 5 || e === 6 || e === 7;

// ---- мелкие фигуры ----
export function sparkle4(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.26 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
export function star5(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
export function heart(ctx, x, y, s, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.95);
  ctx.bezierCurveTo(-s * 1.5, s * 0.1, -s * 0.95, -s * 0.95, 0, -s * 0.38);
  ctx.bezierCurveTo(s * 0.95, -s * 0.95, s * 1.5, s * 0.1, 0, s * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// плотность блёсток на квадратный пиксель: штрих / заливка
export const SPARKLE = {
  1: { stroke: 0.022, fill: 0.012, stars: 0.16 },
  5: { stroke: 0.004, fill: 0.0016, stars: 0.5 },
  6: { stroke: 0.004, fill: 0.0016, stars: 0.5 },
  7: { stroke: 0.006, fill: 0.0025, stars: 0.5 },
  8: { stroke: 0.012, fill: 0.006, stars: 0.16 }, // статичный вид мерцающих блёсток (под анимацией)
};

/** Одна блёстка: цвета подбираются от выбранного цвета кисти. */
export function drawSparkle(ctx, rnd, x, y, e, color, size) {
  const stars = SPARKLE[e].stars;
  const pick = rnd();
  let fill;
  if (e === 1 || e === 8) fill = pick < 0.42 ? '#ffffff' : pick < 0.64 ? '#ffe27a' : pick < 0.84 ? css(mix(color, 0xffffff, 0.55)) : css(mix(color, 0x000000, 0.22));
  else fill = pick < 0.8 ? '#ffffff' : '#fff6c9';
  ctx.fillStyle = fill;
  const s = size * (0.7 + rnd() * 1.2);
  if (rnd() < stars) sparkle4(ctx, x, y, s * 2.4, rnd() * 0.8);
  else { ctx.beginPath(); ctx.arc(x, y, s * 0.75, 0, 6.2832); ctx.fill(); }
}
