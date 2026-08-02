'use strict';

const Issue = require('../models/Issue');

/**
 * Historical Matcher
 *
 * Finds previously resolved issues that are similar to a new issue.
 * Similarity is determined by:
 *   1. Same category (exact match — mandatory)
 *   2. WorkUnits within ±40% of the new issue's WorkUnits
 *
 * The system only learns from issues where GOV recorded actual completion data
 * (resolution.actualWorkerCount and resolution.actualHours).
 */

/**
 * Find historically similar resolved issues.
 *
 * @param {string} category    — issue category (e.g. 'Road & Traffic')
 * @param {number} workUnits   — calculated WorkUnits for the new issue
 * @param {object} options
 * @param {number} [options.tolerancePercent=40] — how far from workUnits to search (%)
 * @param {number} [options.limit=10]            — max cases to return
 * @returns {Promise<Array>}
 */
async function findSimilarCases(category, workUnits, options = {}) {
  const { tolerancePercent = 40, limit = 10 } = options;

  const tolerance = workUnits * (tolerancePercent / 100);
  const minUnits  = Math.max(0, workUnits - tolerance);
  const maxUnits  = workUnits + tolerance;

  const cases = await Issue.find({
    category,
    status:    'Resolved',
    workUnits: { $gte: minUnits, $lte: maxUnits },
    'resolution.actualWorkerCount': { $exists: true, $ne: null },
    'resolution.actualHours':       { $exists: true, $ne: null },
  })
  .select('workUnits resolution aiAnalysis category createdAt')
  .sort({ createdAt: -1 })  // prefer recent cases
  .limit(limit)
  .lean();

  return cases;
}

/**
 * Compute average worker count and hours from historical cases.
 *
 * @param {Array} cases — from findSimilarCases
 * @returns {{ avgWorkers: number, avgHours: number, count: number, spread: string }}
 */
function summariseCases(cases) {
  if (!cases || cases.length === 0) {
    return { avgWorkers: null, avgHours: null, count: 0, spread: 'no data' };
  }

  const workers = cases.map(c => c.resolution.actualWorkerCount).filter(Boolean);
  const hours   = cases.map(c => c.resolution.actualHours).filter(Boolean);

  const avgWorkers = workers.reduce((a, b) => a + b, 0) / workers.length;
  const avgHours   = hours.reduce((a, b) => a + b, 0)   / hours.length;

  const minW = Math.min(...workers);
  const maxW = Math.max(...workers);
  const minH = Math.min(...hours);
  const maxH = Math.max(...hours);

  const spread = `workers: ${minW}–${maxW}, hours: ${minH.toFixed(1)}–${maxH.toFixed(1)}`;

  return {
    avgWorkers: Math.round(avgWorkers * 10) / 10,
    avgHours:   Math.round(avgHours   * 10) / 10,
    count:      cases.length,
    spread,
  };
}

/**
 * Full historical analysis: find cases and summarise them.
 *
 * @param {string} category
 * @param {number} workUnits
 * @returns {Promise<{ cases: Array, summary: object }>}
 */
async function getHistoricalContext(category, workUnits) {
  const cases   = await findSimilarCases(category, workUnits);
  const summary = summariseCases(cases);
  return { cases, summary };
}

module.exports = { findSimilarCases, summariseCases, getHistoricalContext };
