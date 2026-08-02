const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema(
  {
    // ── Core fields (existing — backward compatible) ─────────────────────────
    imageUrl: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      default: '',
    },
    tags: {
      type: [String],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    status: {
      type: String,
      enum: ['Pending', 'In Progress', 'Resolved', 'Rejected'],
      default: 'Pending',
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High'],
      default: 'Low',
    },
    category: {
      type: String,
      enum: ['Road & Traffic', 'Water & Drainage', 'Electricity', 'Sanitation', 'Public Property', 'Other'],
      default: 'Other',
    },
    // How many times this issue (or its duplicates) has been reported
    reportCount: {
      type: Number,
      default: 1,
    },
    // If this record is a duplicate, points to the original issue
    duplicateOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Issue',
      default: null,
    },

    // ── GeoJSON location (2dsphere index for $near queries) ───────────────────
    // Stored as [longitude, latitude] — GeoJSON standard (longitude first!)
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: undefined },
    },

    // ── Async AI pipeline status (frontend polls this) ────────────────────────
    analysisStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },

    // ── AI Analysis block ─────────────────────────────────────────────────────
    aiAnalysis: {
      severity:     { type: Number, min: 1, max: 10 },
      complexity:   { type: Number, min: 1, max: 10 },
      damageArea:   { type: Number },
      damageUnit:   { type: String, default: 'm²' },
      workerRoles:  { type: [String], default: [] },
      confidence:   { type: Number, min: 0, max: 1 },
      isCivicIssue: { type: Boolean, default: true },
      analyzedAt:   { type: Date },
      modelUsed:    { type: String },
    },

    // ── Work Units (pre-computed workload metric) ─────────────────────────────
    // Formula: damageArea × complexity × severityWeight (see workUnitCalculator)
    workUnits: { type: Number, default: null },

    // ── Workforce Estimation ──────────────────────────────────────────────────
    workforceEstimation: {
      workerCount:     { type: Number },
      workerRoles:     { type: [String], default: [] },
      estimatedHours:  { type: Number },
      confidence:      { type: Number },
      reasoning:       { type: String },
      historicalCases: { type: Number },
      estimatedAt:     { type: Date },
      method:          { type: String, enum: ['ai_only', 'historical', 'hybrid'] },
      overriddenBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      overrideReason:  { type: String },
      originalEstimate: {
        workerCount:    Number,
        estimatedHours: Number,
        confidence:     Number,
      },
    },

    // ── Resolution (actual data — trains the historical model) ────────────────
    resolution: {
      actualWorkerCount: { type: Number, default: null },
      actualHours:       { type: Number, default: null },
      resolvedAt:        { type: Date },
      resolvedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      notes:             { type: String },
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
issueSchema.index({ location: '2dsphere' });
issueSchema.index({ status: 1, priority: -1, createdAt: -1 });
issueSchema.index({ latitude: 1, longitude: 1, duplicateOf: 1 });
issueSchema.index(
  { category: 1, workUnits: 1 },
  { partialFilterExpression: { status: 'Resolved', 'resolution.actualWorkerCount': { $exists: true } } }
);
issueSchema.index({ category: 1, 'aiAnalysis.severity': 1 });

module.exports = mongoose.model('Issue', issueSchema);
