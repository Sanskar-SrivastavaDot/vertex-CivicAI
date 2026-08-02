'use strict';

/**
 * Analysis Queue — Lightweight In-Process Job Queue
 *
 * Processes AI analysis jobs asynchronously after the HTTP response is sent.
 * No Redis/Bull: uses a small in-process worker pool (concurrency 2).
 *
 * Hardening vs. a naive setImmediate queue:
 *  - AbortSignal.timeout on Groq calls (a hang cannot stall the pool)
 *  - Concurrency of 2 (not strictly serial)
 *  - Startup recovery sweep for issues left pending/processing by a prior process
 *  - Retry with backoff (5s → 15s → 45s)
 *  - Duplicate detection preserved INSIDE the pipeline (increments reportCount)
 *  - Cloudinary image cleanup for AI-rejected submissions
 *
 * Limitation: jobs are lost on server restart — the recovery sweep mitigates this.
 */

const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Issue = require('../models/Issue');
const { analyseImage } = require('../utils/aiDescriptionGenerator');
const { checkDuplicate } = require('../utils/duplicateDetector');
const { calculateWorkUnits } = require('./workUnitCalculator');
const { getHistoricalContext } = require('./historicalMatcher');
const { estimateWorkforce } = require('./workforceReasoningService');

const MAX_CONCURRENCY = 2;
const RETRY_DELAYS = [5000, 15000, 45000];

// In-process queue
const queue = [];
let inFlight = 0;

function scheduleNext() {
  if (queue.length === 0) return;
  if (inFlight >= MAX_CONCURRENCY) return;
  const job = queue.shift();
  inFlight++;
  runJob(job).finally(() => {
    inFlight--;
    scheduleNext();
  });
}

/**
 * Enqueue an issue for AI analysis.
 * @param {string} issueId       — MongoDB ObjectId string
 * @param {string} imageUrl      — Cloudinary URL
 * @param {string} citizenDesc   — citizen's text description
 */
function enqueueAnalysis(issueId, imageUrl, citizenDesc) {
  queue.push({ issueId, imageUrl, citizenDesc, attempts: 0 });
  console.log(`📋 Enqueued analysis for issue ${issueId}. Queue depth: ${queue.length}`);
  scheduleNext();
}

/**
 * Recover issues left pending/processing by a previous server process.
 * Call once after startup. Re-enqueues them for analysis.
 */
async function recoverStuckIssues() {
  try {
    const stuck = await Issue.find(
      { analysisStatus: { $in: ['pending', 'processing'] } },
      '_id imageUrl description'
    ).lean();
    for (const issue of stuck) {
      enqueueAnalysis(issue._id.toString(), issue.imageUrl, issue.description || '');
    }
    if (stuck.length > 0) {
      console.log(`♻️  Recovery: re-enqueued ${stuck.length} issues left pending by a previous process`);
    }
  } catch (err) {
    console.error('⚠️  Recovery sweep failed:', err.message);
  }
}

async function runJob(job) {
  console.log(`⚙️  Processing analysis for issue ${job.issueId} (attempt ${job.attempts + 1})`);

  try {
    // Mark as processing in DB so frontend can show a spinner
    await Issue.findByIdAndUpdate(job.issueId, { analysisStatus: 'processing' });

    // ── Stage 1: Vision AI ────────────────────────────────────────────────────
    const aiResult = await analyseImage(job.imageUrl, job.citizenDesc);

    // If AI rejects the image as non-civic, mark rejected and clean up storage
    if (!aiResult.isCivicIssue) {
      await Issue.findByIdAndUpdate(job.issueId, {
        status:         'Rejected',
        analysisStatus: 'completed',
        'aiAnalysis.isCivicIssue': false,
        'aiAnalysis.analyzedAt':   new Date(),
        description:    aiResult.description,
      });
      // Storage policy: don't keep rejected selfies/memes
      try {
        await cloudinary.uploader.destroy(publicIdFromUrl(job.imageUrl));
        console.log(`🗑️  Deleted rejected image for issue ${job.issueId}`);
      } catch (_) { /* non-fatal */ }
      console.log(`❌ Issue ${job.issueId} rejected by AI: ${aiResult.description}`);
      return;
    }

    // ── Stage 2: Duplicate detection (feature preservation) ──────────────────
    const saved = await Issue.findById(job.issueId).select('latitude longitude title tags').lean();
    if (saved) {
      const { duplicate, matchedIssue } = await checkDuplicate(
        aiResult.description,
        saved.latitude,
        saved.longitude,
        saved.title,
        saved.tags,
        job.issueId
      );

      if (duplicate && matchedIssue) {
        const newCount = (matchedIssue.reportCount || 1) + 1;
        await Issue.findByIdAndUpdate(matchedIssue._id, { $inc: { reportCount: 1 } });
        await Issue.findByIdAndUpdate(job.issueId, {
          duplicateOf:    matchedIssue._id,
          description:    aiResult.description,
          priority:       matchedIssue.priority,
          category:       matchedIssue.category || aiResult.category,
          status:         matchedIssue.status,
          analysisStatus: 'completed',
          'aiAnalysis.analyzedAt': new Date(),
        });
        console.log(`🔁 Issue ${job.issueId} is a duplicate of ${matchedIssue._id}. reportCount now ${newCount}.`);
        return;
      }
    }

    // ── Stage 3: Work Units calculation ───────────────────────────────────────
    const { workUnits, breakdown } = calculateWorkUnits(
      aiResult.damageArea,
      aiResult.complexity,
      aiResult.severity
    );

    // ── Stage 4: Historical context ───────────────────────────────────────────
    const { cases, summary } = await getHistoricalContext(aiResult.category, workUnits);

    // ── Stage 5: Workforce reasoning ──────────────────────────────────────────
    const workforceResult = await estimateWorkforce(aiResult, workUnits, breakdown, summary, cases);

    // ── Save all results to the Issue document ────────────────────────────────
    await Issue.findByIdAndUpdate(job.issueId, {
      description: aiResult.description,
      priority:    aiResult.priority,
      category:    aiResult.category,

      aiAnalysis: {
        severity:     aiResult.severity,
        complexity:   aiResult.complexity,
        damageArea:   aiResult.damageArea,
        damageUnit:   aiResult.damageUnit,
        workerRoles:  aiResult.workerRoles,
        confidence:   aiResult.confidence,
        isCivicIssue: true,
        analyzedAt:   new Date(),
        modelUsed:    process.env.GROQ_API_KEY ? 'llama-4-scout' : 'mock',
      },

      workUnits,

      workforceEstimation: {
        workerCount:     workforceResult.workerCount,
        workerRoles:     workforceResult.workerRoles,
        estimatedHours:  workforceResult.estimatedHours,
        confidence:      workforceResult.confidence,
        reasoning:       workforceResult.reasoning,
        historicalCases: workforceResult.historicalCases,
        estimatedAt:     new Date(),
        method:          workforceResult.method,
      },

      analysisStatus: 'completed',
    });

    console.log(`✅ Analysis complete for issue ${job.issueId}: ${workforceResult.workerCount} workers, ${workforceResult.estimatedHours}h`);

  } catch (err) {
    console.error(`❌ Analysis failed for issue ${job.issueId}:`, err.message);
    job.attempts++;

    if (job.attempts < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[job.attempts - 1];
      console.log(`🔄 Retrying issue ${job.issueId} in ${delay / 1000}s (attempt ${job.attempts})`);
      setTimeout(() => { queue.push(job); scheduleNext(); }, delay);
      return;
    }

    await Issue.findByIdAndUpdate(job.issueId, { analysisStatus: 'failed' });
    console.error(`💀 Issue ${job.issueId} failed analysis after ${job.attempts} attempts`);
  }
}

function publicIdFromUrl(imageUrl) {
  // Cloudinary public_id = last path segment minus extension
  const clean = String(imageUrl || '').split('?')[0];
  const seg = clean.split('/');
  const last = seg[seg.length - 1] || '';
  return last.replace(/\.[a-z0-9]+$/i, '');
}

module.exports = { enqueueAnalysis, recoverStuckIssues };
