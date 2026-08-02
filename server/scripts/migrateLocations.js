/**
 * Migration: Populate the `location` GeoJSON field from existing latitude/longitude.
 * Run this ONCE after deploying the new Issue schema.
 * Command: node server/scripts/migrateLocations.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/civicai');
  console.log('Connected to MongoDB');

  const Issue = require('../models/Issue');

  // Find all issues that don't have the location field set yet
  const issues = await Issue.find({
    $or: [
      { location: { $exists: false } },
      { 'location.coordinates': { $exists: false } },
    ]
  }).select('_id latitude longitude');

  console.log(`Found ${issues.length} issues to migrate`);

  let updated = 0;
  for (const issue of issues) {
    if (issue.latitude != null && issue.longitude != null) {
      await Issue.updateOne(
        { _id: issue._id },
        {
          $set: {
            location: {
              type: 'Point',
              coordinates: [issue.longitude, issue.latitude], // GeoJSON: [lng, lat]
            },
          },
        }
      );
      updated++;
    }
  }

  console.log(`✅ Migrated ${updated} issues`);
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
