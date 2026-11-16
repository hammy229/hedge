// Written by the calibration step in ml/. Until a trained model is calibrated this
// placeholder keeps the gate closed: calibrated is false, so every ticket is handed off.
export default {
  calibrated: false,
  featureSchema: 1,
  retriever: null,
  alpha: null,
  delta: null,
  calibrationSize: 0,
  threshold: Infinity,
  model: { bias: 0, weights: { summaryWords: 0, hasDescription: 0 } },
};
