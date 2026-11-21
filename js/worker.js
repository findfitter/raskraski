// Web Worker: считает области, чтобы не подвешивать интерфейс на слабом планшете.
import { computeRegions } from './regions.js';

self.onmessage = (e) => {
  const { gray, w, h } = e.data;
  try {
    const res = computeRegions(gray, w, h);
    self.postMessage({ ok: true, res }, [res.map.buffer, res.area.buffer, res.bbox.buffer, res.lx.buffer, res.ly.buffer, res.lr.buffer, res.color.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
