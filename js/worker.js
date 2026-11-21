// Web Worker: считает области, чтобы не подвешивать интерфейс на слабом планшете.
import { computeRegions } from './regions.js';

self.onmessage = (e) => {
  const { id, gray, w, h, opts } = e.data;
  try {
    const res = computeRegions(gray, w, h, opts || {});
    self.postMessage({ id, ok: true, res }, [res.map.buffer, res.area.buffer, res.bbox.buffer, res.lx.buffer, res.ly.buffer, res.lr.buffer, res.color.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
