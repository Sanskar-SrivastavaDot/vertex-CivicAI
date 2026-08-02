/**
 * smokeTest.js — runs the pure, dependency-free services without needing a live
 * server or database, so CI / pre-deploy checks are instant.
 *
 * Run:  node server/scripts/smokeTest.js
 */
const { calculateWorkUnits, estimateFromWorkUnitsOnly, getSeverityBracket } = require('../services/workUnitCalculator');
const { haversineKm, orderTour, optimizeAll } = require('../services/routeOptimizer');

let failures = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label} ${extra}`);
    failures += 1;
  }
}

console.log('CivicAI service smoke test\n');

// ── workUnitCalculator ────────────────────────────────────────────────────────
console.log('workUnitCalculator:');
const calcHigh = calculateWorkUnits(4, 5, 7);
const calcLow  = calculateWorkUnits(2, 1, 1);
check('calculateWorkUnits returns workUnits > 0', typeof calcHigh.workUnits === 'number' && calcHigh.workUnits > 0, `got ${calcHigh.workUnits}`);
check('severe large issue has higher units than low', calcLow.workUnits < calcHigh.workUnits, `${calcLow.workUnits} vs ${calcHigh.workUnits}`);
check('breakdown string present', typeof calcHigh.breakdown === 'string' && calcHigh.breakdown.includes('WorkUnits'));

const est = estimateFromWorkUnitsOnly(20);
check('estimateFromWorkUnitsOnly returns 2..6 workers', est.workerCount >= 2 && est.workerCount <= 6, `got ${est.workerCount}`);
check('estimate returns estimatedHours', est.estimatedHours > 0);

const bracket = getSeverityBracket(8);
check('getSeverityBracket(8) is high', bracket === 'high', `got ${bracket}`);

// ── routeOptimizer ────────────────────────────────────────────────────────────
console.log('\nrouteOptimizer:');
const d1 = haversineKm(80.27, 13.08, 80.28, 13.09);
check('haversineKm ~1.5km for ~0.01° move', d1 > 1 && d1 < 2, `got ${d1.toFixed(2)}`);

const depot = { lat: 13.0827, lng: 80.2707 };
const stops = [
  { _id: 'a', latitude: 13.09, longitude: 80.28 },
  { _id: 'b', latitude: 13.06, longitude: 80.26 },
  { _id: 'c', latitude: 13.07, longitude: 80.25 },
];
const { ordered, totalKm } = orderTour(depot, stops);
check('orderTour returns all stops', ordered.length === 3, `got ${ordered.length}`);
check('orderTour totalKm > 0', totalKm > 0, `got ${totalKm}`);

const teams = [
  {
    _id: { toString: () => 'T1' }, name: 'T1', department: 'Road & Traffic', isActive: true,
    depot: { coordinates: [80.2707, 13.0827] },
    capacity: { maxWorkers: 6, maxHoursPerDay: 8 },
  },
  {
    _id: { toString: () => 'T2' }, name: 'T2', department: 'Sanitation', isActive: true,
    depot: { coordinates: [80.2650, 13.0650] },
    capacity: { maxWorkers: 5, maxHoursPerDay: 8 },
  },
];
const issues = [
  { _id: 'I1', title: 'pothole', description: 'd', category: 'Road & Traffic', priority: 'High', latitude: 13.09, longitude: 80.28, reportCount: 3, workerCount: 6, estimatedHours: 6 },
  { _id: 'I2', title: 'drain', description: 'd', category: 'Water & Drainage', priority: 'Medium', latitude: 13.06, longitude: 80.26, reportCount: 1, workerCount: 4, estimatedHours: 3 },
  { _id: 'I3', title: 'garbage', description: 'd', category: 'Sanitation', priority: 'Medium', latitude: 13.07, longitude: 80.25, reportCount: 2, workerCount: 3, estimatedHours: 2 },
];
const plans = optimizeAll(issues, teams);
check('optimizeAll dispatches at least one team', plans.length >= 1, `got ${plans.length}`);
check('optimizeAll returns distance + duration', plans.every(p => p.totalDistanceKm > 0 && p.estimatedDuration > 0));
const assigned = plans.reduce((s, p) => s + p.stops.length, 0);
check('optimizeAll assigns all feasible issues', assigned >= 2, `got ${assigned}`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? '🎉 ALL SMOKE TESTS PASSED' : `💥 ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
