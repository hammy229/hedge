// Written by the calibration step in ml/ (python -m hedge.calibrate --action link|clear).
// Until a trained model is calibrated these placeholders keep both gates closed:
// calibrated is false, so every ticket is handed off.
const placeholder = (action) => ({
  action,
  calibrated: false,
  featureSchema: 1,
  retriever: null,
  alpha: null,
  delta: null,
  calibrationSize: 0,
  threshold: Infinity,
  model: { bias: 0, weights: { summaryWords: 0, hasDescription: 0 } },
});

export default { link: placeholder('link'), clear: placeholder('clear') };
