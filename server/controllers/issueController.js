const path = require('path');
const Issue = require('../models/Issue');
const { enqueueAnalysis } = require('../services/analysisQueue');

// ─── POST /api/issues ─────────────────────────────────────────────────────────
/**
 * Submit a new civic issue. Returns 202 immediately — the AI analysis
 * (classification + workforce estimation + duplicate detection) runs
 * asynchronously in the background queue. Frontend polls GET /:id/status.
 */
async function createIssue(req, res) {
  try {
    // Validate file upload
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const { latitude, longitude, title, tags, description: citizenDescription } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Location (latitude & longitude) is required' });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Invalid coordinates provided' });
    }

    // Cloudinary returns the secure image URL in req.file.path.
    // Local disk fallback returns a filesystem path — expose it as a URL
    // served by this API (GET /uploads/<name>) so the client can load it.
    let imageUrl = req.file.path;
    if (!/^https?:\/\//.test(imageUrl)) {
      const filename = path.basename(imageUrl);
      imageUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;
    }

    // Save the issue immediately with placeholder data.
    // The AI analysis runs asynchronously in the background.
    const issue = new Issue({
      imageUrl,
      description:    citizenDescription || 'Analysis in progress...',
      latitude:       lat,
      longitude:      lon,
      location: {
        type:        'Point',
        coordinates: [lon, lat], // GeoJSON: [longitude, latitude]
      },
      title:          title || '',
      // Accept tags as a JSON array string, a plain comma-separated string, or an array.
      tags:           tags
        ? Array.isArray(tags)
          ? tags
          : (() => {
              try { return JSON.parse(tags); }
              catch { return String(tags).split(',').map(t => t.trim()).filter(Boolean); }
            })()
        : [],
      status:         'Pending',
      priority:       'Low',         // Updated by AI in the background
      category:       'Other',       // Updated by AI in the background
      reportCount:    1,
      analysisStatus: 'pending',     // Frontend polls this
      createdBy:      req.user ? req.user.userId : null,
    });

    await issue.save();
    console.log(`✅ Issue ${issue._id} saved. Enqueueing AI analysis...`);

    // Enqueue background analysis — does NOT block the HTTP response
    enqueueAnalysis(issue._id.toString(), imageUrl, citizenDescription || '');

    return res.status(202).json({
      message: 'Issue received. AI analysis is running in the background.',
      issueId: issue._id,
      issue,
    });
  } catch (error) {
    console.error('❌ createIssue error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

// ─── GET /api/issues/:id/status ────────────────────────────────────────────────
/**
 * Lightweight polling endpoint. Frontend calls until analysisStatus is
 * 'completed' or 'failed'. If the issue turned out to be a duplicate, this
 * returns duplicate + reportCount + originalIssue so the UI can show
 * "Already reported N times".
 */
async function getIssueAnalysisStatus(req, res) {
  try {
    const issue = await Issue.findById(req.params.id)
      .select('analysisStatus status priority category description aiAnalysis workforceEstimation workUnits duplicateOf reportCount createdBy')
      .lean();

    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    if (issue.duplicateOf) {
      const original = await Issue.findById(issue.duplicateOf)
        .select('reportCount priority category description status')
        .lean();
      if (original) {
        return res.json({
          ...issue,
          duplicate:      true,
          reportCount:    original.reportCount,
          originalIssue:  original,
        });
      }
    }

    return res.json(issue);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── GET /api/issues ──────────────────────────────────────────────────────────
/**
 * Fetch all non-duplicate (original) issues with optional search/filter query params.
 * Query params: search, priority, status. Citizen contact info (reporters) is
 * only returned to authenticated GOV callers.
 */
async function getAllIssues(req, res) {
  try {
    const { search, priority, status, includeDuplicates } = req.query;
    const filter = {};

    // By default only return original issues (not duplicate records)
    if (includeDuplicates !== 'true') {
      filter.duplicateOf = null;
    }

    if (priority && priority !== 'All') filter.priority = priority;
    if (status   && status   !== 'All') filter.status   = status;
    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: 'i' } },
        { title:       { $regex: search, $options: 'i' } },
      ];
    }

    const issues = await Issue.find(filter)
      .sort({ reportCount: -1, createdAt: -1 })
      .limit(200) // cap so the public map/dashboard stay fast
      .populate('createdBy', 'name email citizenId profileDetails');

    // ── Fetch all duplicate records linked to these originals ──────────────────
    const originalIds = issues.map(i => i._id);
    const duplicates  = await Issue.find(
      { duplicateOf: { $in: originalIds } },
      'duplicateOf createdBy'
    ).populate('createdBy', 'name email citizenId profileDetails');

    // Build map: originalId → [extra reporters]
    const dupReportersMap = {};
    for (const d of duplicates) {
      const key = d.duplicateOf.toString();
      if (!dupReportersMap[key]) dupReportersMap[key] = [];
      if (d.createdBy) dupReportersMap[key].push(d.createdBy);
    }

    // Reporters (full PII) are only returned to authenticated GOV callers.
    const isGOV = req.user && req.user.role === 'GOV';

    const result = issues.map(issue => {
      const obj = issue.toObject();
      if (isGOV) {
        const extras = dupReportersMap[issue._id.toString()] || [];
        obj.reporters = issue.createdBy ? [issue.createdBy, ...extras] : extras;
      } else if (issue.createdBy) {
        obj.createdBy = { _id: issue.createdBy._id, name: issue.createdBy.name };
      }
      return obj;
    });

    return res.json({ issues: result, total: result.length });
  } catch (error) {
    console.error('❌ getAllIssues error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── PUT /api/issues/:id ──────────────────────────────────────────────────────
/**
 * Update issue status (Pending → In Progress → Resolved).
 */
async function updateIssueStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['Pending', 'In Progress', 'Resolved', 'Rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    if (status === 'Resolved') {
      console.log(`⚠️  Issue ${id} marked Resolved via status update. Consider using PUT /api/issues/${id}/resolution to record actual workers and hours for historical learning.`);
    }

    const issue = await Issue.findByIdAndUpdate(id, {
      status,
      updatedBy: req.user ? req.user.userId : null,
    }, { new: true });

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.json({ message: 'Status updated successfully', issue });
  } catch (error) {
    console.error('❌ updateIssueStatus error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── GET /api/issues/heatmap ──────────────────────────────────────────────────
/**
 * Return lightweight coordinate data for heatmap visualization.
 * Uses reportCount as intensity multiplier.
 */
async function getHeatmapData(req, res) {
  try {
    const issues = await Issue.find(
      { duplicateOf: null },
      'latitude longitude priority reportCount -_id'
    );

    const heatmapPoints = issues.map((issue) => ({
      lat: issue.latitude,
      lng: issue.longitude,
      // Intensity: priority weight × report count (capped at 10)
      intensity:
        (issue.priority === 'High' ? 3 : issue.priority === 'Medium' ? 2 : 1) *
        Math.min(issue.reportCount || 1, 10),
    }));

    return res.json({ points: heatmapPoints });
  } catch (error) {
    console.error('❌ getHeatmapData error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── GET /api/issues/my ───────────────────────────────────────────────────────
async function getMyIssues(req, res) {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const issues = await Issue.find({ createdBy: req.user.userId }).sort({ createdAt: -1 });
    return res.json({ issues, total: issues.length });
  } catch (error) {
    console.error('❌ getMyIssues error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── PUT /api/issues/:id/workforce ────────────────────────────────────────────
/**
 * GOV only — override the AI's workforce estimate.
 * Records both the original AI estimate and the human override for auditing.
 */
async function overrideWorkforceEstimate(req, res) {
  try {
    const { id } = req.params;
    const { workerCount, workerRoles, estimatedHours, overrideReason } = req.body;

    if (!workerCount || !estimatedHours) {
      return res.status(400).json({ error: 'workerCount and estimatedHours are required' });
    }
    if (workerCount < 1 || workerCount > 50) {
      return res.status(400).json({ error: 'workerCount must be between 1 and 50' });
    }
    if (estimatedHours < 0.5 || estimatedHours > 48) {
      return res.status(400).json({ error: 'estimatedHours must be between 0.5 and 48' });
    }

    const issue = await Issue.findById(id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    // Preserve the original AI estimate before overriding
    const originalEstimate = issue.workforceEstimation
      ? {
          workerCount:    issue.workforceEstimation.workerCount,
          estimatedHours: issue.workforceEstimation.estimatedHours,
          confidence:     issue.workforceEstimation.confidence,
        }
      : null;

    await Issue.findByIdAndUpdate(id, {
      'workforceEstimation.workerCount':      workerCount,
      'workforceEstimation.workerRoles':      workerRoles || issue.workforceEstimation?.workerRoles || [],
      'workforceEstimation.estimatedHours':   estimatedHours,
      'workforceEstimation.overriddenBy':     req.user.userId,
      'workforceEstimation.overrideReason':   overrideReason || '',
      'workforceEstimation.originalEstimate': originalEstimate,
      updatedBy: req.user.userId,
    });

    const updated = await Issue.findById(id);
    return res.json({ message: 'Workforce estimate overridden successfully', issue: updated });
  } catch (err) {
    console.error('❌ overrideWorkforceEstimate error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── PUT /api/issues/:id/resolution ───────────────────────────────────────────
/**
 * GOV only — record actual completion data when resolving an issue.
 * This is the key endpoint for historical learning — every call with real
 * data makes future workforce estimates better.
 */
async function recordResolution(req, res) {
  try {
    const { id } = req.params;
    const { actualWorkerCount, actualHours, notes } = req.body;

    if (!actualWorkerCount || !actualHours) {
      return res.status(400).json({
        error: 'actualWorkerCount and actualHours are required. This data improves future AI estimates.',
      });
    }

    if (actualWorkerCount < 1 || actualWorkerCount > 50) {
      return res.status(400).json({ error: 'actualWorkerCount must be between 1 and 50' });
    }
    if (actualHours < 0.1 || actualHours > 72) {
      return res.status(400).json({ error: 'actualHours must be between 0.1 and 72' });
    }

    const issue = await Issue.findById(id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const updated = await Issue.findByIdAndUpdate(
      id,
      {
        status: 'Resolved',
        resolution: {
          actualWorkerCount: Number(actualWorkerCount),
          actualHours:       Number(actualHours),
          notes:             notes || '',
          resolvedAt:        new Date(),
          resolvedBy:        req.user.userId,
        },
        updatedBy: req.user.userId,
      },
      { new: true }
    );

    console.log(`📊 Resolution recorded for issue ${id}: ${actualWorkerCount} workers, ${actualHours}h. Historical pool grows.`);

    return res.json({
      message: 'Resolution recorded. This data will improve future workforce estimates.',
      issue: updated,
    });
  } catch (err) {
    console.error('❌ recordResolution error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── GET /api/dashboard (legacy, kept for compatibility) ──────────────────────
async function getDashboard(req, res) {
  try {
    const issues = await Issue.find({ duplicateOf: null }, 'title tags status priority category latitude longitude createdAt').sort({ createdAt: -1 });

    // Extract unique tags
    const allTags = new Set();
    issues.forEach(issue => {
      if (issue.tags && issue.tags.length > 0) {
        issue.tags.forEach(tag => allTags.add(tag));
      }
    });

    return res.json({
      issues,
      tags: Array.from(allTags),
      total: issues.length,
    });
  } catch (error) {
    console.error('❌ getDashboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createIssue,
  getAllIssues,
  updateIssueStatus,
  getHeatmapData,
  getMyIssues,
  getDashboard,
  getIssueAnalysisStatus,
  overrideWorkforceEstimate,
  recordResolution,
};
