/**
 * Seeds initial work teams. Edit the depot coordinates and names for your city.
 * Run once: node server/scripts/seedWorkTeams.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const WorkTeam = require('../models/WorkTeam');

const TEAMS = [
  {
    name: 'Road Team 1',
    department: 'Road & Traffic',
    depot: { type: 'Point', coordinates: [80.2707, 13.0827], address: 'Central Depot, Chennai' },
    capacity: { maxWorkers: 6, maxHoursPerDay: 8 },
  },
  {
    name: 'Road Team 2',
    department: 'Road & Traffic',
    depot: { type: 'Point', coordinates: [80.2500, 13.0700], address: 'North Depot, Chennai' },
    capacity: { maxWorkers: 5, maxHoursPerDay: 8 },
  },
  {
    name: 'Drainage Team 1',
    department: 'Water & Drainage',
    depot: { type: 'Point', coordinates: [80.2607, 13.0900], address: 'Water Works Depot' },
    capacity: { maxWorkers: 4, maxHoursPerDay: 8 },
  },
  {
    name: 'Electrical Team 1',
    department: 'Electricity',
    depot: { type: 'Point', coordinates: [80.2800, 13.0750], address: 'Electrical Sub-station' },
    capacity: { maxWorkers: 3, maxHoursPerDay: 8 },
  },
  {
    name: 'Sanitation Team 1',
    department: 'Sanitation',
    depot: { type: 'Point', coordinates: [80.2650, 13.0650], address: 'Sanitation Yard' },
    capacity: { maxWorkers: 5, maxHoursPerDay: 8 },
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/civicai');
  console.log('Connected');
  await WorkTeam.deleteMany({});
  const teams = await WorkTeam.insertMany(TEAMS);
  console.log(`✅ Seeded ${teams.length} work teams`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
