/**
 * routeOptimizer.js
 * Pure functions for daily route optimization:
 *   - Haversine distance between coordinates
 *   - Capacity-aware assignment of issues to work teams
 *   - Nearest-neighbor tour with 2-opt refinement (starts & ends at depot)
 * No external deps — free-tier friendly (no map API needed).
 */

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two [lng, lat] points. */
function haversineKm(lng1, lat1, lng2, lat2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Convert minutes → human readable duration string. */
function formatDuration(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Order a list of stops starting & ending at the depot using
 * nearest-neighbor + 2-opt local search.
 * @param {{ _id: string, lat: number, lng: number }} depot
 * @param {Array<{ _id, latitude, longitude }>} stops
 * @returns {{ ordered: [], totalKm: number }}
 */
function orderTour(depot, stops) {
  if (!stops || stops.length === 0) return { ordered: [], totalKm: 0 };
  if (stops.length === 1) {
    const km = 2 * haversineKm(depot.lng, depot.lat, stops[0].longitude, stops[0].latitude);
    return { ordered: [stops[0]], totalKm: km };
  }

  // Nearest-neighbor greedy construction
  let remaining = stops.map((s) => ({ ...s, visited: false }));
  const ordered = [];
  let current = { lat: depot.lat, lng: depot.lng };

  for (let i = 0; i < stops.length; i++) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let j = 0; j < remaining.length; j++) {
      if (remaining[j].visited) continue;
      const d = haversineKm(current.lng, current.lat, remaining[j].longitude, remaining[j].latitude);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }
    remaining[bestIdx].visited = true;
    ordered.push(remaining[bestIdx]);
    current = { lat: remaining[bestIdx].latitude, lng: remaining[bestIdx].longitude };
  }

  // 2-opt refinement — re-route pairs of edges if it shortens the tour
  const points = [depot, ...ordered, depot].map((p) => ({
    lat: p.lat !== undefined ? p.lat : p.latitude,
    lng: p.lng !== undefined ? p.lng : p.longitude,
  }));
  const totalPoints = points.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < totalPoints - 2; i++) {
      for (let j = i + 1; j < totalPoints - 1; j++) {
        const a = points[i - 1], b = points[i], c = points[j], d = points[j + 1];
        const before = haversineKm(a.lng, a.lat, b.lng, b.lat) + haversineKm(c.lng, c.lat, d.lng, d.lat);
        const after  = haversineKm(a.lng, a.lat, c.lng, c.lat) + haversineKm(b.lng, b.lat, d.lng, d.lat);
        if (after < before - 1e-6) {
          // Reverse the sub-tour between i and j
          const rev = points.slice(i, j + 1).reverse();
          points.splice(i, j - i + 1, ...rev);
          improved = true;
        }
      }
    }
  }

  const totalKm = points.reduce((sum, p, idx) => {
    if (idx === 0) return 0;
    const prev = points[idx - 1];
    return sum + haversineKm(prev.lng, prev.lat, p.lng, p.lat);
  }, 0);

  return { ordered, totalKm };
}

/**
 * Assign issues to teams with capacity constraints, then build optimized tours.
 *
 * @param {Array<{ _id, latitude, longitude, priority, reportCount, workerCount, estimatedHours, category, department }>} issues
 * @param {Array<{ _id, name, department, depot, capacity, isActive }>} teams
 * @returns {Array<{ teamId, teamName, department, stops: Array, totalDistanceKm, estimatedDuration, capacityUtilization }>}
 */
function optimizeAll(issues, teams) {
  const results = teams.map((team) => ({
    teamId:      team._id.toString(),
    teamName:    team.name,
    department:  team.department,
    depot:       team.depot.coordinates, // [lng, lat]
    assigned:    [],   // { issue, workerCount, estimatedHours }
    totalWorkHours: 0, // worker-hours consumed
  }));

  const unassigned = [];
  const weight = (issue) => {
    const p = issue.priority === 'High' ? 100 : issue.priority === 'Medium' ? 40 : 10;
    return p + Math.min(issue.reportCount || 1, 10) * 2;
  };

  // Greedy assignment — try each unassigned issue against each team
  const sortedIssues = [...issues].sort((a, b) => weight(b) - weight(a));

  for (const issue of sortedIssues) {
    let best = null;
    let bestCost = Infinity;

    for (const result of results) {
      const team = teams.find((t) => t._id.toString() === result.teamId);
      if (!team || !team.isActive) continue;

      // Capacity: team's per-worker hours vs issue requirements
      const issueWorkerHours = issue.workerCount * issue.estimatedHours;
      const maxWorkerHours = team.capacity.maxWorkers * team.capacity.maxHoursPerDay;
      if (issue.workerCount > team.capacity.maxWorkers) continue;
      if (result.totalWorkHours + issueWorkerHours > maxWorkerHours) continue;

      // Department match bonus — teams prefer their own category
      const deptMatches = issue.department && issue.department === team.department;

      // Marginal distance cost of adding this stop to the team's depot
      const depot = { lat: team.depot.coordinates[1], lng: team.depot.coordinates[0] };
      const lastStop = result.assigned[result.assigned.length - 1];
      const from = lastStop
        ? { lat: lastStop.issue.latitude, lng: lastStop.issue.longitude }
        : depot;
      const marginalKm = haversineKm(from.lng, from.lat, issue.longitude, issue.latitude);
      const cost = marginalKm - (deptMatches ? 2 : 0);

      if (cost < bestCost) {
        bestCost = cost;
        best = result;
      }
    }

    if (best) {
      best.assigned.push({
        issue,
        workerCount:     issue.workerCount,
        estimatedHours:  issue.estimatedHours,
      });
      best.totalWorkHours += issue.workerCount * issue.estimatedHours;
    } else {
      unassigned.push(issue);
    }
  }

  // Build final routes with tour ordering
  return results
    .filter((r) => r.assigned.length > 0)
    .map((r) => {
      const depot = { lat: r.depot[1], lng: r.depot[0] };
      const { ordered, totalKm } = orderTour(
        depot,
        r.assigned.map((a) => a.issue)
      );

      // Duration estimate: 25 km/h city driving + 25 min service per stop
      const travelMin = (totalKm / 25) * 60;
      const serviceMin = r.assigned.reduce((s, a) => s + (a.estimatedHours || 0.5) * 60, 0);
      const estimatedDuration = Math.round(travelMin + serviceMin);

      return {
        teamId:        r.teamId,
        teamName:      r.teamName,
        department:    r.department,
        stops:         ordered.map((issue, idx) => ({ issue: issue._id.toString(), order: idx })),
        stopDetails:   ordered.map((issue) => ({
          issueId:       issue._id.toString(),
          title:         issue.title || '',
          description:   issue.description || '',
          category:      issue.category || 'Other',
          priority:      issue.priority || 'Low',
          latitude:      issue.latitude,
          longitude:     issue.longitude,
          workerCount:   issue.workerCount,
          estimatedHours: issue.estimatedHours,
        })),
        totalDistanceKm:   Math.round(totalKm * 100) / 100,
        estimatedDuration, // minutes
        capacityUtilization: Math.min(
          Math.round((r.totalWorkHours / (r.assigned.length * 8 * 6)) * 100),
          100
        ),
      };
    });
}

module.exports = { haversineKm, orderTour, optimizeAll, formatDuration };
