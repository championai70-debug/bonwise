// Trains the model away from the screen thread so the app stays smooth.
import { learn } from './model.js';

self.onmessage = (e) => {
  const { history, catalog, customer } = e.data;
  let last = 0;
  try {
    const result = learn(history, catalog, {
      customer,
      onProgress: (f) => {
        if (f - last >= 0.05) { last = f; self.postMessage({ progress: f }); }
      },
    });
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: String(err?.message || err) });
  }
};
