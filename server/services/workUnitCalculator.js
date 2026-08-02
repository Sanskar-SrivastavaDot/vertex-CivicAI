'use strict';

/**
 * Work Unit Calculator
 *
 * WorkUnits is a universal, explainable workload metric.
 * It normalises different issue types onto a single scale so
 * historical cases can be compared fairly.
 *
 * Formula:
 *   WorkUnits = damageArea × complexity × severityWeight
 *
 * severityWeight:
 *   severity 1–3  → 1.0  (Low)
 *   severity 4–6  → 1.5  (Medium)
 *   severity 7–10 → 2.0  (High)
 */

const SEVERITY_WEIGHTS = {
  low:    1.0,  // severity 1–3
  medium: 1.5,  // severity 4–6
  high:   2.0,  // severity 7–10
};

/**
 * Get the severity bracket label from a numeric severity score.
 * @param {number} severity — integer 1–10
 * @returns {'low' | 'medium' | 'high'}
 */
function getSeverityBracket(severity) {
  if (severity <= 3) return 'low';
  if (severity <= 6) return 'medium';
  return 'high';
}

/**
 * Calculate WorkUnits for a given set of AI analysis values.
 *
 * @param {number} damageArea  — numeric area/length/count from AI analysis
 * @param {number} complexity  — integer 1–10 from AI analysis
 * @param {number} severity    — integer 1–10 from AI analysis
 * @returns {{ workUnits: number, severityBracket: string, severityWeight: number, breakdown: string }}
 */
function calculateWorkUnits(damageArea, complexity, severity) {
  // Clamp inputs to valid ranges
  const area = Math.max(0.1, Number(damageArea) || 1);
  const comp = Math.min(10, Math.max(1, Math.round(Number(complexity) || 3)));
  const sev  = Math.min(10, Math.max(1, Math.round(Number(severity)  || 3)));

  const bracket = getSeverityBracket(sev);
  const weight  = SEVERITY_WEIGHTS[bracket];

  // Core formula
  const raw = area * comp * weight;

  // Round to 1 decimal place
  const workUnits = Math.round(raw * 10) / 10;

  // Human-readable breakdown for transparency / UI display
  const breakdown = `${area} × ${comp} × ${weight} (${bracket} severity) = ${workUnits} WorkUnits`;

  return { workUnits, severityBracket: bracket, severityWeight: weight, breakdown };
}

/**
 * Estimate workers and hours from WorkUnits alone (no historical data).
 * Used as a pure fallback when no historical cases exist.
 *
 * @param {number} workUnits
 * @param {string[]} workerRoles — from AI analysis
 * @returns {{ workerCount: number, estimatedHours: number }}
 */
function estimateFromWorkUnitsOnly(workUnits, workerRoles) {
  // Heuristic: a single skilled worker can process ~5 WorkUnits per hour
  const UNITS_PER_WORKER_HOUR = 5;

  // Team size: log scale — small jobs don't need huge teams
  let workerCount;
  if      (workUnits <= 20)  workerCount = 2;
  else if (workUnits <= 60)  workerCount = 3;
  else if (workUnits <= 150) workerCount = 4;
  else if (workUnits <= 300) workerCount = 5;
  else                       workerCount = 6;

  const totalWorkerHours = workUnits / UNITS_PER_WORKER_HOUR;
  const estimatedHours   = Math.round((totalWorkerHours / workerCount) * 10) / 10;

  return { workerCount, estimatedHours };
}

module.exports = { calculateWorkUnits, estimateFromWorkUnitsOnly, getSeverityBracket };
