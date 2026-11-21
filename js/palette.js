// Палитры. Режим «по цифрам»: 14 цветов с номерами. Свободный режим: 24 оттенка + свой цвет.

const rgb = (hex) => parseInt(hex.slice(1), 16);

export const NUM_COLORS = [
  ['Красный', '#E53935'], ['Оранжевый', '#FB8C00'], ['Жёлтый', '#FDD835'], ['Салатовый', '#9CCC3C'],
  ['Зелёный', '#2E9E4F'], ['Бирюзовый', '#1FB5A8'], ['Голубой', '#5BC0F0'], ['Синий', '#2F5FD0'],
  ['Фиолетовый', '#8E4FC9'], ['Розовый', '#F48FB1'], ['Коричневый', '#8D5A3B'], ['Бежевый', '#F2CFA0'],
  ['Серый', '#9AA0A6'], ['Кремовый', '#FFF1B8'],
].map(([name, hex], i) => ({ n: i + 1, name, hex, rgb: rgb(hex) }));

export const FREE_COLORS = [
  '#E53935', '#FB8C00', '#FDD835', '#C0CA33', '#43A047', '#1B5E20',
  '#00897B', '#26C6DA', '#4FC3F7', '#1E88E5', '#1A237E', '#5E35B1',
  '#8E24AA', '#D81B60', '#F48FB1', '#F8BBD0', '#FFCCBC', '#F2C9A0',
  '#8D6E63', '#4E342E', '#9E9E9E', '#424242', '#111111', '#FFFFFF',
].map((hex) => ({ hex, rgb: rgb(hex) }));

export function hexOf(v) { return '#' + (v >>> 0).toString(16).padStart(6, '0'); }
export function inkOn(v) {
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1c1c28' : '#ffffff';
}
