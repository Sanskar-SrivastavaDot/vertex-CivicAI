require('dotenv').config();
const mongoose = require('mongoose');
const Issue = require('../models/Issue');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const all = await Issue.find({ duplicateOf: { $ne: null } })
    .select('_id duplicateOf title reportCount')
    .lean();
  const bad = all.filter((s) => String(s.duplicateOf) === String(s._id));
  console.log(`total with duplicateOf: ${all.length} | self-duplicates: ${bad.length}`);
  if (bad.length) {
    for (const b of bad) console.log(`  self-dup: ${String(b._id).slice(-6)} "${b.title}" reportCount=${b.reportCount}`);
    const r = await Issue.deleteMany({ $expr: { $eq: ['$duplicateOf', '$_id'] } });
    console.log(`deleted: ${r.deletedCount}`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
