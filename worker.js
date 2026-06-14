/**
 * worker.js — RetirementSim Web Worker
 *
 * Offloads heavy simulations off the main UI thread.
 * Place in the same directory as simulator.js.
 *
 * Usage in your app:
 *
 *   var worker = new Worker('worker.js');
 *
 *   worker.postMessage({
 *     task:   'monteCarlo',   // or 'stress' or 'tornado'
 *     params: params,         // RetirementSim.defaultParams() + your overrides
 *     N:      10000           // simulation count
 *   });
 *
 *   worker.onmessage = function(e) {
 *     var result = e.data;    // same return shape as direct API calls
 *     console.log(result);
 *   };
 *
 *   worker.onerror = function(e) {
 *     console.error('Worker error:', e.message);
 *   };
 */

importScripts('simulator.js');

self.onmessage = function (e) {
  var task   = e.data.task   || 'monteCarlo';
  var params = e.data.params || RetirementSim.defaultParams();
  var N      = e.data.N      || 2000;
  var baseSR = e.data.baseSR || 75;  // needed for tornado

  var result;

  try {
    if (task === 'monteCarlo') {
      result = RetirementSim.runMonteCarlo(params, N);
    } else if (task === 'stress') {
      result = RetirementSim.runStressTests(params, N);
    } else if (task === 'tornado') {
      result = RetirementSim.buildTornado(params, baseSR, N);
    } else if (task === 'scenario') {
      result = RetirementSim.runScenario(params, N);
    } else {
      result = { error: 'Unknown task: ' + task };
    }
  } catch (err) {
    result = { error: err.message };
  }

  self.postMessage({ task: task, result: result });
};