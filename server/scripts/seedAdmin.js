/**
 * Seed script — creates the GOV authority account for "Vertex"
 * Run with:  node server/scripts/seedAdmin.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const User     = require('../models/User');

const ADMIN = {
  name:       'Vertex Authority',
  email:      'vertex@civicai.gov',
  password:   '123456789',
  role:       'GOV',
  department: 'Road & Traffic',
  // Optional: also create a demo citizen for live testing
};

const CITIZEN = {
  name:     'Demo Citizen',
  email:    'demo@citizen.in',
  password: '123456789',
  role:     'Citizen',
};

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/civicai');
  console.log('✅ Connected to MongoDB');

  const existing = await User.findOne({ email: ADMIN.email });

  if (existing) {
    // Update password in case it changed
    existing.password   = await bcrypt.hash(ADMIN.password, 10);
    existing.role       = 'GOV';
    existing.name       = ADMIN.name;
    existing.department = ADMIN.department;
    await existing.save();
    console.log('🔄 Authority account updated:', ADMIN.email);
  } else {
    const hashed = await bcrypt.hash(ADMIN.password, 10);
    await User.create({
      name:       ADMIN.name,
      email:      ADMIN.email,
      password:   hashed,
      role:       'GOV',
      department: ADMIN.department,
    });
    console.log('🎉 Authority account created:', ADMIN.email);
  }

  // Optional demo citizen (only created if it doesn't exist yet)
  const citizenExists = await User.findOne({ email: CITIZEN.email });
  if (!citizenExists) {
    const hashed = await bcrypt.hash(CITIZEN.password, 10);
    let citizenId;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = 'CIV-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const clash = await User.findOne({ citizenId: candidate }).select('_id').lean();
      if (!clash) { citizenId = candidate; break; }
    }
    await User.create({ ...CITIZEN, password: hashed, citizenId });
    console.log('👤 Demo citizen account created:', CITIZEN.email);
  }

  console.log('\n─────────────────────────────────────');
  console.log('  Authority Login Credentials');
  console.log('─────────────────────────────────────');
  console.log('  Authority ID :', ADMIN.email);
  console.log('  Password     :', ADMIN.password);
  console.log('  Role         :', 'GOV');
  console.log('  Department   :', ADMIN.department);
  console.log('\n  Demo Citizen Login');
  console.log('  Citizen ID   :', CITIZEN.email);
  console.log('  Password     :', CITIZEN.password);
  console.log('─────────────────────────────────────\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
