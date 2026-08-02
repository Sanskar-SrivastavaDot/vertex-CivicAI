const WorkTeam = require('../models/WorkTeam');
const WorkRoute = require('../models/WorkRoute');
const Issue = require('../models/Issue');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
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
 * POST /api/routes/teams
 * Create a new work team (GOV).
 * Body: { name, department, depot: { coordinates: [lng,lat], address }, capacity }
 */
async function createTeam(req, res) {
  try {
    const { name, department, depot, capacity } = req.body;
    if (!name || !department) {
      return res.status(400).json({ error: 'name and department are required.' });
    }
    const team = await WorkTeam.create({
      name,
      department,
      depot: {
        type: 'Point',
        coordinates: Array.isArray(depot?.coordinates) ? depot.coordinates : [80.2707, 13.0827],
        address: depot?.address || '',
      },
      capacity: {
        maxWorkers: Number(capacity?.maxWorkers) || 6,
        maxHoursPerDay: Number(capacity?.maxHoursPerDay) || 8,
      },
    });
    return res.status(201).json({ message: 'Team created.', team });
  } catch (err) {
    console.error('❌ createTeam error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/routes/teams/:id
 * Update a work team's details (GOV).
 */
async function updateTeam(req, res) {
  try {
    const { id } = req.params;
    const { name, department, depot, capacity } = req.body;

    const team = await WorkTeam.findById(id);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (name)       team.name = name;
    if (department) team.department = department;
    if (depot) {
      team.depot.address = depot.address ?? team.depot.address;
      if (Array.isArray(depot.coordinates)) team.depot.coordinates = depot.coordinates;
    }
    if (capacity) {
      if (capacity.maxWorkers != null) team.capacity.maxWorkers = Number(capacity.maxWorkers);
      if (capacity.maxHoursPerDay != null) team.capacity.maxHoursPerDay = Number(capacity.maxHoursPerDay);
    }

    await team.save();
    return res.json({ message: 'Team updated.', team });
  } catch (err) {
    console.error('❌ updateTeam error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/routes/teams/:id
 * Deactivate a work team (GOV). Soft-delete — kept for historical routes.
 */
async function deleteTeam(req, res) {
  try {
    const { id } = req.params;
    const team = await WorkTeam.findById(id);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    team.isActive = false;
    await team.save();
    return res.json({ message: 'Team deactivated.' });
  } catch (err) {
    console.error('❌ deleteTeam error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/routes/workers
 * List GOV users who can be assigned as field workers.
 */
async function getWorkers(req, res) {
  try {
    const workers = await User.find({ role: 'GOV' })
      .select('name email department')
      .sort({ name: 1 });
    return res.json({ workers });
  } catch (err) {
    console.error('❌ getWorkers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/routes/workers
 * Create a new GOV worker account (GOV).
 * Body: { name, email, password, department }
 */
async function createWorker(req, res) {
  try {
    const { name, email, password, department } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required.' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'A user with this email already exists.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword, role: 'GOV', department: department || null });

    return res.status(201).json({
      message: 'Worker created.',
      worker: { id: user._id, name: user.name, email: user.email, department: user.department },
    });
  } catch (err) {
    console.error('❌ createWorker error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/routes/teams/:id/members
 * Assign a GOV user to a team (GOV). Body: { userId }
 */
async function addTeamMember(req, res) {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    const team = await WorkTeam.findById(id);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (team.members.some((m) => m.toString() === userId)) {
      return res.status(400).json({ error: 'User is already in this team.' });
    }

    team.members.push(userId);
    await team.save();
    return res.status(201).json({ message: 'Member added.', team });
  } catch (err) {
    console.error('❌ addTeamMember error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/routes/teams/:id/members/:memberId
 * Remove a GOV user from a team (GOV).
 */
async function removeTeamMember(req, res) {
  try {
    const { id, memberId } = req.params;
    const team = await WorkTeam.findById(id);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    team.members = team.members.filter((m) => m.toString() !== memberId);
    await team.save();
    return res.json({ message: 'Member removed.', team });
  } catch (err) {
    console.error('❌ removeTeamMember error:', err);
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

module.exports = {
  generateRoutes,
  getRoutes,
  completeStop,
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  getWorkers,
  createWorker,
  addTeamMember,
  removeTeamMember,
};
