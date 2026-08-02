const stringSimilarity = require('string-similarity');
const Issue = require('../models/Issue');

/**
 * calculateDistance
 * Haversine formula to compute distance (meters) between two GPS coordinates.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Civic issue keyword lexicon — the vocabulary we use to decide that two
 * reports are about the "same issue" without relying on full-sentence text
 * similarity (which is fragile because the AI re-describes the same photo
 * differently on every run). Matching on keywords like "pothole" or "garbage"
 * plus spatial proximity is far more robust for real citizens.
 */
const CIVIC_KEYWORDS = [
  // Road & Traffic
  'pothole', 'road', 'asphalt', 'pavement', 'footpath', 'sidewalk',
  'traffic', 'signal', 'speed breaker', 'divider', 'crater', 'crack',
  // Sanitation / Garbage
  'garbage', 'trash', 'waste', 'rubbish', 'litter', 'dump', 'bin',
  'debris', 'overflow', 'smell', 'stench', 'sweep',
  // Water Supply & Drainage
  'drain', 'sewer', 'sewage', 'manhole', 'flood', 'waterlogging',
  'stagnant', 'leak', 'pipe', 'monsoon', 'rain',
  // Street Lighting
  'streetlight', 'lamp', 'bulb', 'pole', 'lighting', 'dark',
  // Public Works / Other
  'broken', 'cover', 'railing', 'bench', 'signage', 'construction',
  'encroach', 'illegal', 'tree', 'treefall', 'hoarding',
];

// Normalize common phrasings so "street light", "lamp post" etc. map to one keyword.
const NORMALIZE = [
  ['street light', 'streetlight'],
  ['lamp post', 'streetlight'],
  ['water logging', 'waterlogging'],
  ['garbage bin', 'garbage'],
  ['dust bin', 'garbage'],
  ['gully pit', 'drain'],
];

function normalizeText(text) {
  let t = String(text || '').toLowerCase();
  for (const [from, to] of NORMALIZE) t = t.split(from).join(to);
  return t;
}

/**
 * Extract the civic keywords present in a piece of text (title + description + tags).
 * @returns {Set<string>} matched keywords (from the lexicon)
 */
function extractKeywords(text) {
  const t = normalizeText(text);
  const found = new Set();
  for (const kw of CIVIC_KEYWORDS) {
    if (t.includes(kw)) found.add(kw);
  }
  return found;
}

/**
 * checkDuplicate
 * A new report is a duplicate of an existing one when BOTH hold:
 *   1. It is within the spatial radius (50m) of the existing issue, AND
 *   2. They share at least one civic keyword (e.g. both mention "pothole" or
 *      "garbage") — falling back to title similarity for off-lexicon cases.
 * When matched, the caller increments the original's reportCount so that
 * repeatedly-reported issues rise in the dashboard/heatmap.
 *
 * @param {string} newDescription - AI-generated description of the new issue
 * @param {number} latitude - Latitude of the new issue
 * @param {number} longitude - Longitude of the new issue
 * @param {string} newTitle - Citizen's title for the new issue
 * @param {string[]} newTags - Citizen's tags for the new issue
 * @param {string} [currentIssueId] - The new issue's own _id (excluded from candidates)
 * @returns {Promise<{ duplicate: boolean, matchedIssue: object|null, matchedKeywords: string[] }>}
 */
async function checkDuplicate(newDescription, latitude, longitude, newTitle = '', newTags = [], currentIssueId = null) {
  try {
    // Rough bounding box for the DB query (~220m); the 50m radius is applied below.
    const SEARCH_RADIUS_DEG = 0.002;
    const DISTANCE_THRESHOLD = 50; // meters — same-location radius
    const TITLE_SIMILARITY_FALLBACK = 0.8;

    const nearbyIssues = await Issue.find({
      _id: { $ne: currentIssueId }, // never match an issue against itself
      duplicateOf: null,
      latitude: { $gte: latitude - SEARCH_RADIUS_DEG, $lte: latitude + SEARCH_RADIUS_DEG },
      longitude: { $gte: longitude - SEARCH_RADIUS_DEG, $lte: longitude + SEARCH_RADIUS_DEG },
    });

    if (!nearbyIssues.length) {
      return { duplicate: false, matchedIssue: null, matchedKeywords: [] };
    }

    const newKeywords = extractKeywords([newTitle, newDescription, (newTags || []).join(' ')].join(' '));

    let bestMatch = null;
    let bestScore = 0;
    let bestKeywords = [];

    for (const issue of nearbyIssues) {
      const distance = calculateDistance(latitude, longitude, issue.latitude, issue.longitude);
      if (distance > DISTANCE_THRESHOLD) continue;

      const issueText = normalizeText(
        [issue.title, issue.description, (issue.tags || []).join(' ')].join(' ')
      );

      // Primary signal: shared civic keywords (same issue type at same location).
      const shared = [...newKeywords].filter((kw) => issueText.includes(kw));
      if (shared.length > 0) {
        const score = shared.length * (1 - distance / DISTANCE_THRESHOLD);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = issue;
          bestKeywords = shared;
        }
        continue;
      }

      // Fallback: near-identical citizen titles (stable text, not AI-generated).
      if (!newTitle) continue;
      const titleSim = stringSimilarity.compareTwoStrings(
        newTitle.toLowerCase(),
        (issue.title || '').toLowerCase()
      );
      if (titleSim >= TITLE_SIMILARITY_FALLBACK) {
        const score = titleSim * (1 - distance / DISTANCE_THRESHOLD);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = issue;
          bestKeywords = ['title'];
        }
      }
    }

    if (bestMatch) {
      const dist = calculateDistance(latitude, longitude, bestMatch.latitude, bestMatch.longitude);
      console.log(
        `✅ Duplicate detected (${dist.toFixed(1)}m away, keywords: ${bestKeywords.join(', ')}): ` +
        `"${(bestMatch.title || '').substring(0, 50)}..."`
      );
      return { duplicate: true, matchedIssue: bestMatch, matchedKeywords: bestKeywords };
    }

    return { duplicate: false, matchedIssue: null, matchedKeywords: [] };
  } catch (error) {
    console.error('❌ Duplicate check failed:', error.message);
    return { duplicate: false, matchedIssue: null, matchedKeywords: [] };
  }
}

module.exports = { checkDuplicate, calculateDistance, extractKeywords };
