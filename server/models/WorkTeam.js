const mongoose = require('mongoose');

/**
 * WorkTeam — A municipal repair team with a home depot and department assignment.
 * Teams are assigned clusters of issues for route optimization.
 */
const workTeamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "Road Team 1"
    department: {
      type: String,
      required: true,
      enum: ['Road & Traffic', 'Water & Drainage', 'Electricity', 'Sanitation', 'Public Property'],
    },

    // Depot = where this team starts and ends each day
    depot: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [longitude, latitude]
      address:     { type: String },
    },

    capacity: {
      maxWorkers:     { type: Number, default: 6 },
      maxHoursPerDay: { type: Number, default: 8 },
    },

    isActive: { type: Boolean, default: true },

    // GOV users who are members of this team
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

workTeamSchema.index({ depot: '2dsphere' });
workTeamSchema.index({ department: 1, isActive: 1 });

module.exports = mongoose.model('WorkTeam', workTeamSchema);
