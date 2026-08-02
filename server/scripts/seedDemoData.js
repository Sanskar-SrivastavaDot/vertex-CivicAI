/**
 * Demo data seeder — creates realistic issues (with completed AI analysis) so
 * the dashboard, workforce estimates, and route optimizer have data to show.
 *
 * Run:  node server/scripts/seedDemoData.js            (creates demo issues)
 *       node server/scripts/seedDemoData.js RESET=true (clears issues first)
 *
 * NOTE: coordinates below are Chennai, India. Edit for your demo city.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Issue = require('../models/Issue');
const User = require('../models/User');
const WorkTeam = require('../models/WorkTeam');

const DEMO_CITIZEN = {
  name: 'Demo Citizen',
  email: 'demo@citizen.in',
  password: '123456789',
  role: 'Citizen',
};

const DEMO_ISSUES = [
  {
    title: 'Large pothole on Anna Salai near Gemini Circle',
    description: 'A wide pothole (~4m²) on the bus lane is causing repeated vehicle damage and near-misses during peak hours.',
    category: 'Road & Traffic',
    priority: 'High',
    status: 'Pending',
    reportCount: 3,
    latitude: 13.0595,
    longitude: 80.2561,
    severity: 8, complexity: 6, damageArea: 4.2, confidence: 0.92,
    workerCount: 6, estimatedHours: 4, roles: ['Asphalt Layer', 'Labourer', 'Road Technician'],
  },
  {
    title: 'Broken streetlight cluster on Mount Road',
    description: 'Three streetlights out on a dark stretch — increased pedestrian risk and evening crime concern.',
    category: 'Electricity',
    priority: 'Medium',
    status: 'In Progress',
    reportCount: 2,
    latitude: 13.0635,
    longitude: 80.2580,
    severity: 5, complexity: 2, damageArea: 1, confidence: 0.88,
    workerCount: 2, estimatedHours: 2, roles: ['Electrician'],
  },
  {
    title: 'Blocked storm drain at Adyar junction',
    description: 'Drain is choked with silt and plastic; waterlogging after light rain floods the footpath.',
    category: 'Water & Drainage',
    priority: 'Medium',
    status: 'Pending',
    reportCount: 1,
    latitude: 13.0066,
    longitude: 80.2570,
    severity: 5, complexity: 5, damageArea: 6, confidence: 0.9,
    workerCount: 4, estimatedHours: 3, roles: ['Drainage Worker', 'Labourer'],
  },
  {
    title: 'Overflowing garbage dump at Nungambakkam',
    description: 'Municipal bin overflowing for a week; stray animals and foul smell reported by residents.',
    category: 'Sanitation',
    priority: 'Medium',
    status: 'Pending',
    reportCount: 2,
    latitude: 13.0550,
    longitude: 80.2475,
    severity: 4, complexity: 2, damageArea: 8, confidence: 0.95,
    workerCount: 3, estimatedHours: 2, roles: ['Sanitation Worker'],
  },
  {
    title: 'Broken footbridge railing near Beach station',
    description: 'Railing section collapsed, leaving an open drop for pedestrians above the tracks.',
    category: 'Public Property',
    priority: 'High',
    status: 'Pending',
    reportCount: 1,
    latitude: 13.0917,
    longitude: 80.2940,
    severity: 8, complexity: 8, damageArea: 2.5, confidence: 0.89,
    workerCount: 5, estimatedHours: 5, roles: ['Welder', 'Labourer', 'Structural Technician'],
  },
  {
    title: 'Deep pothole cluster on Inner Ring Road',
    description: 'Multiple connected potholes spanning ~10m stretch; two-wheeler accidents reported this week.',
    category: 'Road & Traffic',
    priority: 'High',
    status: 'Resolved',
    reportCount: 4,
    latitude: 13.0418,
    longitude: 80.1700,
    severity: 8, complexity: 8, damageArea: 10, confidence: 0.91,
    workerCount: 6, estimatedHours: 6, roles: ['Asphalt Layer', 'Labourer', 'Road Technician'],
    resolution: { actualWorkerCount: 6, actualHours: 5.5, notes: 'Patched with hot-mix asphalt, rolled same day.' },
  },
  {
    title: 'Water leak from mainline at T. Nagar',
    description: 'Crack in the supply line wasting water and weakening the road surface above it.',
    category: 'Water & Drainage',
    priority: 'Medium',
    status: 'Resolved',
    reportCount: 2,
    latitude: 13.0402,
    longitude: 80.2341,
    severity: 5, complexity: 5, damageArea: 3, confidence: 0.87,
    workerCount: 4, estimatedHours: 4, roles: ['Plumber', 'Labourer', 'Pump Operator'],
    resolution: { actualWorkerCount: 3, actualHours: 3, notes: 'Replaced 2m pipe section and joint.' },
  },
  {
    title: 'Vandalized bus shelter glass at Koyambedu',
    description: 'Shattered glass panel and graffiti; sharp shards near bus stop seating.',
    category: 'Public Property',
    priority: 'Low',
    status: 'Resolved',
    reportCount: 1,
    latitude: 13.0720,
    longitude: 80.1950,
    severity: 2, complexity: 2, damageArea: 2, confidence: 0.93,
    workerCount: 2, estimatedHours: 1.5, roles: ['Carpenter', 'Labourer'],
    resolution: { actualWorkerCount: 2, actualHours: 1, notes: 'Replaced panel, cleaned area.' },
  },
];

async function seed() {
  const reset = process.argv.includes('RESET=true');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/civicai');
  console.log('✅ Connected to MongoDB');

  const existingCount = await Issue.countDocuments({});
  if (existingCount > 0 && !reset) {
    console.log(`⚠️  Found ${existingCount} existing issues. Skipping (pass RESET=true to clear first).`);
    await mongoose.disconnect();
    process.exit(0);
  }
  if (reset) {
    await Issue.deleteMany({});
    console.log('🗑️  Cleared existing issues.');
  }

  // Ensure demo citizen exists
  let citizen = await User.findOne({ email: DEMO_CITIZEN.email });
  if (!citizen) {
    citizen = await User.create({ ...DEMO_CITIZEN, password: await bcrypt.hash(DEMO_CITIZEN.password, 10) });
    console.log('👤 Created demo citizen:', DEMO_CITIZEN.email);
  }

  // Ensure work teams exist so route planning works immediately
  const teamCount = await WorkTeam.countDocuments({});
  if (teamCount === 0) {
    const teams = await WorkTeam.insertMany([
      { name: 'Road Team 1', department: 'Road & Traffic', depot: { type: 'Point', coordinates: [80.2707, 13.0827], address: 'Central Depot, Chennai' }, capacity: { maxWorkers: 6, maxHoursPerDay: 8 } },
      { name: 'Drainage Team 1', department: 'Water & Drainage', depot: { type: 'Point', coordinates: [80.2607, 13.0900], address: 'Water Works Depot' }, capacity: { maxWorkers: 4, maxHoursPerDay: 8 } },
      { name: 'Electrical Team 1', department: 'Electricity', depot: { type: 'Point', coordinates: [80.2800, 13.0750], address: 'Electrical Sub-station' }, capacity: { maxWorkers: 3, maxHoursPerDay: 8 } },
      { name: 'Sanitation Team 1', department: 'Sanitation', depot: { type: 'Point', coordinates: [80.2650, 13.0650], address: 'Sanitation Yard' }, capacity: { maxWorkers: 5, maxHoursPerDay: 8 } },
      { name: 'Public Property Team 1', department: 'Public Property', depot: { type: 'Point', coordinates: [80.2500, 13.0700], address: 'Facilities Depot' }, capacity: { maxWorkers: 5, maxHoursPerDay: 8 } },
    ]);
    console.log(`🏗️  Seeded ${teams.length} work teams`);
  }

  const docs = DEMO_ISSUES.map((d, i) => ({
    title: d.title,
    description: d.description,
    category: d.category,
    priority: d.priority,
    status: d.status,
    reportCount: d.reportCount,
    latitude: d.latitude,
    longitude: d.longitude,
    location: { type: 'Point', coordinates: [d.longitude, d.latitude] },
    imageUrl: `https://picsum.photos/seed/civicai${i}/800/500`,
    tags: [],
    createdBy: citizen._id,
    analysisStatus: 'completed',
    aiAnalysis: {
      isCivicIssue: true,
      severity: d.severity,
      complexity: d.complexity,
      damageArea: d.damageArea,
      damageUnit: 'm²',
      workerRoles: d.roles,
      confidence: d.confidence,
      analyzedAt: new Date(),
      modelUsed: 'demo-seed',
    },
    workUnits: Math.round(d.damageArea * (d.complexity / 5) * (d.severity <= 3 ? 1 : d.severity <= 6 ? 1.5 : 2) * 10) / 10,
    workforceEstimation: {
      workerCount: d.workerCount,
      estimatedHours: d.estimatedHours,
      workerRoles: d.roles,
      confidence: d.confidence,
      method: 'ai_only',
      historicalCases: 0,
      estimatedAt: new Date(),
    },
    ...(d.resolution ? {
      resolution: { ...d.resolution, resolvedAt: new Date(Date.now() - 3 * 86400000), resolvedBy: null },
    } : {}),
    createdAt: new Date(Date.now() - i * 3600000),
    updatedAt: new Date(Date.now() - i * 3600000),
  }));

  const inserted = await Issue.insertMany(docs);
  console.log(`📋 Seeded ${inserted.length} demo issues`);
  console.log('   - Pending/In Progress issues are ready for "Generate Routes" in the Authority Dashboard.');
  console.log('   - Resolved issues carry actuals — they train the historical workforce model.');

  await mongoose.disconnect();
  console.log('✅ Done. Demo citizen login: demo@citizen.in / 123456789');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
