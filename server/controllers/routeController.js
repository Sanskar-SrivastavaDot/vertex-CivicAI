const WorkTeam = require('../models/WorkTeam');
const WorkRoute = require('../models/WorkRoute');
const Issue = require('../models/Issue');
const { optimizeAll, formatDuration } = require('../services/routeOptimizer');

/** Normalize a date string / Date to a JS Date at local midnight. */
function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date();
  return d;
}

/**
 * POST /api/routes/generate
 * Generate optimized daily routes for all active work teams.
 * Pending/In-Progress issues with a workforce estimate are dispatched.
 * Idempotent per (date, team) — existing Planned/In-Progress routes are returned.
 */
async function generateRoutes(req, res) {
  try {
    const date = parseDate(req.body.date);
    const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(date); endOfDay.setHours(23, 59, 59, 999);

    // Already generated for today? Return existing, don't duplicate.
    const existing = await WorkRoute.find({ date: { $gte: startOfDay, $lte: endOfDay } })
      .populate('team', 'name department capacity depot')
      .populate('stops.issue', 'title description category priority status latitude longitude workforceEstimation');
    if (existing.length > 0) {
      return res.json({
        message: 'Routes already exist for this date — returning existing.',
        routes: existing,
      });
    }

    const teams = await WorkTeam.find({ isActive: true });
    if (teams.length === 0) {
      return res.status(400).json({
        error: 'No active work teams found. Seed teams first with: node server/scripts/seedWorkTeams.js',
      });
    }

    // Candidate issues: original, actionable, with a workforce estimate
    const issues = await Issue.find({
      duplicateOf: null,
      status: { $in: ['Pending', 'In Progress'] },
      'workforceEstimation.workerCount': { $exists: true, $ne: null, $gt: 0 },
    }).select(
      'title description category priority status latitude longitude reportCount ' +
      'workforceEstimation.workerCount workforceEstimation.estimatedHours'
    ).lean();

    if (issues.length === 0) {
      return res.status(400).json({
        error: 'No issues ready for dispatch. Submit reports with completed AI analysis first.',
      });
    }

    // Shape for the optimizer
    const issueShapes = issues.map((i) => ({
      _id:           i._id,
      title:         i.title,
      description:   i.description,
      category:      i.category,
      priority:      i.priority,
      latitude:      i.latitude,
      longitude:     i.longitude,
      reportCount:   i.reportCount || 1,
      department:    i.category,
      workerCount:   i.workforceEstimation.workerCount,
      estimatedHours: i.workforceEstimation.estimatedHours,
    }));

    const optimized = optimizeAll(issueShapes, teams);

    if (optimized.length === 0) {
      return res.status(400).json({
        error: 'No issues could be assigned to teams (capacity/team constraints).',
      });
    }

    // Persist one WorkRoute per team
    const routes = [];
    for (const plan of optimized) {
      const route = await WorkRoute.create({
        team: plan.teamId,
        date: startOfDay,
        status: 'Planned',
        stops: plan.stops.map((s, i) => ({
          issue: s.issue,
          order: i,
          estimatedArrival: null, // optional: set with cumulative time
        })),
        totalDistanceKm:   plan.totalDistanceKm,
        estimatedDuration: plan.estimatedDuration,
        optimizationMeta: {
          algorithm:   'nearest_neighbor_2opt',
          generatedAt: new Date(),
          issueCount:  plan.stops.length,
        },
        createdBy: req.user ? req.user.userId : null,
      });
      routes.push({
        _id:            route._id,
        team:           { _id: plan.teamId, name: plan.teamName, department: plan.department },
        date:           route.date,
        status:         route.status,
        stops:          plan.stopDetails.map((d, i) => ({ ...d, order: i })),
        totalDistanceKm:   route.totalDistanceKm,
        estimatedDuration: route.estimatedDuration,
        estimatedDurationLabel: formatDuration(route.estimatedDuration),
        capacityUtilization: plan.capacityUtilization,
      });
    }

    const unassignedCount = issues.length - optimized.reduce((s, p) => s + p.stops.length, 0);

    return res.status(201).json({
      message: `Dispatched ${optimized.length} team route(s).`,
      routes,
      stats: {
        teamsDispatched: optimized.length,
        stopsPlanned: optimized.reduce((s, p) => s + p.stops.length, 0),
        unassigned: unassignedCount,
      },
    });
  } catch (err) {
    console.error('❌ generateRoutes error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/routes?date=YYYY-MM-DD&status=Planned
 * List routes (GOV). Populates team + issue details for rendering.
 */
async function getRoutes(req, res) {
  try {
    const filter = {};
    if (req.query.status && req.query.status !== 'All') filter.status = req.query.status;
    if (req.query.date) {
      const d = parseDate(req.query.date);
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end   = new Date(d); end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const routes = await WorkRoute.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(50)
      .populate('team', 'name department capacity depot')
      .populate('stops.issue', 'title description category priority status latitude longitude reportCount workforceEstimation')
      .populate('createdBy', 'name email');

    const shaped = routes.map((r) => {
      const obj = r.toObject(); // deep-converts subdocuments to plain objects
      obj.estimatedDurationLabel = formatDuration(r.estimatedDuration);
      obj.stops = (obj.stops || [])
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((s) => ({
          ...s,
          issueDetails: s.issue
            ? {
                _id:            s.issue._id,
                title:          s.issue.title,
                description:    s.issue.description,
                category:       s.issue.category,
                priority:       s.issue.priority,
                status:         s.issue.status,
                latitude:       s.issue.latitude,
                longitude:      s.issue.longitude,
                reportCount:    s.issue.reportCount,
                workerCount:    s.issue.workforceEstimation?.workerCount,
                estimatedHours: s.issue.workforceEstimation?.estimatedHours,
              }
            : null,
        }));
      return obj;
    });

    return res.json({ routes: shaped, total: shaped.length });
  } catch (err) {
    console.error('❌ getRoutes error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/routes/:routeId/stop/:stopId
 * Mark a single stop complete (field team progress).
 */
async function completeStop(req, res) {
  try {
    const { routeId, stopId } = req.params;

    const route = await WorkRoute.findById(routeId);
    if (!route) return res.status(404).json({ error: 'Route not found' });

    const stop = route.stops.find((s) => s._id.toString() === stopId);
    if (!stop) return res.status(404).json({ error: 'Stop not found on this route' });

    stop.completed = true;
    stop.completedAt = new Date();
    stop.actualArrival = new Date();

    // If all stops complete → route is done
    if (route.stops.every((s) => s.completed)) {
      route.status = 'Completed';
      route.actualDuration = route.estimatedDuration;
    } else {
      route.status = 'In Progress';
    }

    await route.save();

    // Keep the linked issue in sync
    if (stop.issue) {
      await Issue.findByIdAndUpdate(stop.issue, { status: 'Resolved' }, { new: false });
    }

    return res.json({ message: 'Stop marked complete.', route });
  } catch (err) {
    console.error('❌ completeStop error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/routes/teams
 * List active work teams (for the planner UI).
 */
async function getTeams(req, res) {
  try {
    const teams = await WorkTeam.find({ isActive: true })
      .select('name department depot capacity members')
      .populate('members', 'name email');
    return res.json({ teams });
  } catch (err) {
    console.error('❌ getTeams error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { generateRoutes, getRoutes, completeStop, getTeams };
