const mongoose = require('mongoose');

/**
 * WorkRoute — An optimized daily route assigned to a team.
 * Contains an ordered list of issue stops. Persisted so teams can view
 * their assignments and completion is tracked.
 */
const workRouteSchema = new mongoose.Schema(
  {
    team:   { type: mongoose.Schema.Types.ObjectId, ref: 'WorkTeam', required: true },
    date:   { type: Date, required: true },
    status: {
      type: String,
      enum: ['Planned', 'In Progress', 'Completed'],
      default: 'Planned',
    },

    // Ordered list of stops (issues to visit, in optimized sequence)
    stops: [
      {
        issue:            { type: mongoose.Schema.Types.ObjectId, ref: 'Issue' },
        order:            { type: Number },           // 0-indexed visit sequence
        estimatedArrival: { type: Date },
        actualArrival:    { type: Date },
        completed:        { type: Boolean, default: false },
        completedAt:      { type: Date },
      },
    ],

    // Route statistics
    totalDistanceKm:   { type: Number },
    estimatedDuration: { type: Number }, // total minutes
    actualDuration:    { type: Number },

    // Metadata about how this route was generated
    optimizationMeta: {
      algorithm:    { type: String }, // 'nearest_neighbor_2opt'
      clusterId:    { type: String },
      generatedAt:  { type: Date },
      issueCount:   { type: Number },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

workRouteSchema.index({ date: 1, team: 1 });
workRouteSchema.index({ status: 1, date: -1 });
workRouteSchema.index({ 'stops.issue': 1 });

module.exports = mongoose.model('WorkRoute', workRouteSchema);
