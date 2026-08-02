'use strict';

/**
 * Workforce Reasoning Service
 *
 * Takes the AI analysis, calculated WorkUnits, and historical cases,
 * then calls Groq text API to produce a final, explainable workforce estimate.
 *
 * Free API: Groq (same GROQ_API_KEY used for vision)
 * Model: llama-3.3-70b-versatile
 *
 * Falls back to a formula-based estimate if Groq is unavailable.
 */

const { estimateFromWorkUnitsOnly } = require('./workUnitCalculator');

// ── Build the reasoning prompt ────────────────────────────────────────────────
function buildPrompt(aiAnalysis, workUnits, breakdown, historicalSummary, historicalCases) {
  const caseLines = historicalCases.slice(0, 5).map((c, i) =>
    `  Case ${i + 1}: WorkUnits=${c.workUnits}, Workers=${c.resolution.actualWorkerCount}, Hours=${c.resolution.actualHours}`
  ).join('\n');

  const historicalSection = historicalSummary.count > 0
    ? `HISTORICAL DATA (${historicalSummary.count} similar resolved cases found):
${caseLines}
Historical averages: ${historicalSummary.avgWorkers} workers, ${historicalSummary.avgHours} hours
Historical spread: ${historicalSummary.spread}`
    : `HISTORICAL DATA: No similar resolved cases found yet. Use AI analysis and WorkUnits only.`;

  return `You are a municipal workforce planning expert.
Estimate the workforce required to repair this civic issue.
Respond ONLY with a valid JSON object — no markdown, no preamble.

ISSUE ANALYSIS:
  Category:    ${aiAnalysis.category}
  Severity:    ${aiAnalysis.severity}/10
  Complexity:  ${aiAnalysis.complexity}/10
  Damage Area: ${aiAnalysis.damageArea} ${aiAnalysis.damageUnit}
  Work Units:  ${workUnits} (formula: ${breakdown})
  AI Roles Suggested: ${(aiAnalysis.workerRoles || []).join(', ')}

${historicalSection}

INSTRUCTIONS:
- Worker count should be a whole number between 1 and 10
- Repair hours should be realistic (typically 1–16 hours)
- Confidence: 0.5–0.65 if no history, 0.75–0.95 if good historical data
- Reasoning: one paragraph (2–3 sentences) explaining WHY you chose this count,
  referencing either the historical cases or the damage analysis. Be specific.
  A government officer must be able to read this and explain it to their supervisor.

Required JSON:
{
  "workerCount": <integer 1–10>,
  "workerRoles": ["<role1>", "<role2>"],
  "estimatedHours": <number>,
  "confidence": <number 0.0–1.0>,
  "reasoning": "<2–3 sentence explanation>"
}`;
}

// ── Call Groq text API ────────────────────────────────────────────────────────
async function callGroqText(prompt) {
  const token = process.env.GROQ_API_KEY;
  if (!token) throw new Error('GROQ_API_KEY not set');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model:           'llama-3.3-70b-versatile',
      messages:        [{ role: 'user', content: prompt }],
      max_tokens:      400,
      temperature:     0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq text API ${response.status}: ${text}`);
  }

  const result  = await response.json();
  const raw     = result.choices?.[0]?.message?.content?.trim() || '{}';
  const parsed  = JSON.parse(raw);

  return {
    workerCount:    Math.round(Math.min(10, Math.max(1, Number(parsed.workerCount) || 3))),
    workerRoles:    Array.isArray(parsed.workerRoles) ? parsed.workerRoles : [],
    estimatedHours: Math.round((Number(parsed.estimatedHours) || 4) * 10) / 10,
    confidence:     Math.min(1, Math.max(0, Number(parsed.confidence) || 0.6)),
    reasoning:      typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : 'Estimate based on damage analysis.',
  };
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * estimateWorkforce
 *
 * @param {object} aiAnalysis       — from analyseImage()
 * @param {number} workUnits        — from calculateWorkUnits()
 * @param {string} breakdown        — human-readable formula string
 * @param {object} historicalSummary — from summariseCases()
 * @param {Array}  historicalCases  — from findSimilarCases()
 * @returns {Promise<object>}
 */
async function estimateWorkforce(aiAnalysis, workUnits, breakdown, historicalSummary, historicalCases) {
  const method = historicalSummary.count > 0 ? 'hybrid' : 'ai_only';

  if (process.env.GROQ_API_KEY) {
    try {
      console.log(`🧠 Workforce reasoning (${method}) — calling Groq text model...`);
      const result = await callGroqText(
        buildPrompt(aiAnalysis, workUnits, breakdown, historicalSummary, historicalCases)
      );
      // Fill in roles from AI if the text model didn't return them
      if (!result.workerRoles || result.workerRoles.length === 0) {
        result.workerRoles = aiAnalysis.workerRoles || [];
      }
      console.log(`✅ Workforce estimate: ${result.workerCount} workers, ${result.estimatedHours}h, confidence ${result.confidence}`);
      return { ...result, method, historicalCases: historicalSummary.count };
    } catch (err) {
      console.warn(`⚠️  Workforce reasoning API failed: ${err.message} — using formula fallback`);
    }
  }

  // Formula-only fallback
  console.log('📐 Using formula-only workforce estimate (no Groq key)');
  const fallback = estimateFromWorkUnitsOnly(workUnits, aiAnalysis.workerRoles || []);
  return {
    ...fallback,
    workerRoles:    aiAnalysis.workerRoles || [],
    confidence:     0.5,
    reasoning:      `Estimate based on WorkUnits formula (${breakdown}). No historical data available yet. As more issues are resolved and recorded, this estimate will improve.`,
    method:         'ai_only',
    historicalCases: 0,
  };
}

module.exports = { estimateWorkforce };
