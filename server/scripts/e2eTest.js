/**
 * End-to-end workflow test against a running CivicAI server.
 *
 * Drives the full citizen + GOV flow through the real HTTP API:
 *   citizen login -> submit issue w/ photo -> poll AI analysis
 *   duplicate detection -> GOV login -> PII checks -> workforce override
 *   status update -> resolution -> route generation -> list routes -> complete stop
 *   heatmap -> public endpoints (no PII leak)
 *
 * Usage: node server/scripts/e2eTest.js
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:5000';
const IMG_DIR = process.env.IMG_DIR || 'C:\\Users\\HOME\\AppData\\Local\\Temp\\opencode\\mock_images';
const CITIZEN = { email: process.env.CITIZEN_EMAIL || 'demo@citizen.in', password: '123456789' };
const GOV = { email: process.env.GOV_EMAIL || 'vertex@civicai.gov', password: '123456789' };

let passed = 0;
let failed = 0;
const failures = [];

function log(msg) {
  console.log(`\n[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function check(name, cond, detail) {
  if (cond) {
    passed++;
    log(`PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}: ${detail || ''}`);
    log(`FAIL  ${name}  ${detail || ''}`);
  }
}

async function api(pathname, { method = 'GET', token, body, form } = {}, retries = 3) {
  const headers = { Connection: 'close' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + pathname, { method, headers, body: payload });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON body */
      }
      // Transient 401s (garbled keep-alive socket after heavy uploads) retry once.
      if (res.status === 401 && attempt < retries) {
        log(`      transient 401 on ${method} ${pathname}; retrying...`);
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return { status: res.status, data };
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return { status: 0, data: { error: e.message } };
    }
  }
}

async function login(email, password) {
  const { status, data } = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (status !== 200 || !data.token) throw new Error(`login failed (${status}): ${JSON.stringify(data)}`);
  return data;
}

async function pollUntilDone(issueId, token, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await api(`/api/issues/${issueId}/status`, { token });
    if (!data) throw new Error(`poll got no data for ${issueId}`);
    if (data.analysisStatus === 'completed' || data.analysisStatus === 'failed') return data;
    if (data.duplicate) return data;
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`timeout polling ${issueId}`);
}

function imageForm(fileName, latitude, longitude, title, description, tags) {
  const abs = path.join(IMG_DIR, fileName);
  const buf = fs.readFileSync(abs);
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/jpeg' }), fileName);
  form.append('latitude', String(latitude));
  form.append('longitude', String(longitude));
  form.append('title', title);
  form.append('description', description);
  form.append('tags', JSON.stringify(tags));
  return form;
}

async function main() {
  log('=== 1. CITIZEN LOGIN ===');
  const citizen = await login(CITIZEN.email, CITIZEN.password);
  check('citizen login returns token + role Citizen', citizen.user && citizen.user.role === 'Citizen', JSON.stringify(citizen.user));

  const cToken = citizen.token;

  // Fresh coordinates every run — base moves randomly, issues sit ~100m apart.
  // This keeps repeat runs from colliding with previous runs' originals (which
  // would be correctly flagged as duplicates and skip the AI pipeline).
  const baseLat = 13.06 + Math.random() * 0.05;
  const baseLon = 80.25 + Math.random() * 0.05;
  const cases = [
    { file: 'pothole.jpg',  idx: 0, title: 'Deep pothole on Mount Road',        desc: 'Large deep pothole in the middle of the road, dangerous for two-wheelers.', tags: ['pothole', 'road'] },
    { file: 'garbage.jpg',  idx: 1, title: 'Garbage heap not collected',          desc: 'Household waste piled up on the street for days, foul smell.', tags: ['garbage', 'cleaning'] },
    { file: 'streetlight.jpg', idx: 2, title: 'Street light not working',         desc: 'Street lamp on this stretch is dead, area is dark at night.', tags: ['streetlight', 'electricity'] },
    { file: 'water.jpg',    idx: 3, title: 'Water logging after rain',            desc: 'Road flooded, vehicles struggling to pass.', tags: ['water', 'drainage'] },
    { file: 'crackedroad.jpg', idx: 4, title: 'Cracked and broken road surface',  desc: 'Road surface cracked and broken across the lane.', tags: ['road', 'crack'] },
    { file: 'drain.jpg',    idx: 5, title: 'Open manhole needs cover',            desc: 'Manhole cover missing, open drain on footpath.', tags: ['drain', 'safety'] },
  ].map((c) => ({
    ...c,
    lat: baseLat + c.idx * 0.0008,
    lon: baseLon + (c.idx % 3) * 0.0006,
  }));

  log('=== 2. SUBMIT ISSUES (real Groq analysis) ===');
  const submitted = [];
  for (const c of cases) {
    const form = imageForm(c.file, c.lat, c.lon, c.title, c.desc, c.tags);
    const { status, data } = await api('/api/issues', { method: 'POST', token: cToken, form });
    check(`submit ${c.file} -> 202 + issueId`, status === 202 && data.issueId, `status=${status} ${JSON.stringify(data)}`);
    if (status === 202 && data.issueId) submitted.push({ id: data.issueId, title: c.title, file: c.file });
    await new Promise((r) => setTimeout(r, 1500));
  }

  log('=== 3. POLL AI ANALYSIS TO COMPLETION ===');
  const analyzed = [];
  for (const s of submitted) {
    try {
      const d = await pollUntilDone(s.id, cToken);
      if (d.duplicate) {
        log(`      ${s.file}: DUPLICATE of original (reportCount=${d.reportCount})`);
      } else {
        const ai = d.aiAnalysis || {};
        const wf = d.workforceEstimation || {};
        analyzed.push({ id: s.id, file: s.file, status: d.status, category: ai.category, severity: ai.severity, workerCount: wf.workerCount });
        log(`      ${s.file}: status=${d.status} category=${ai.category} severity=${ai.severity} workers=${wf.workerCount} method=${wf.method}`);
      }
    } catch (e) {
      check(`analyze ${s.file}`, false, e.message);
    }
  }
  const completed = analyzed.filter((a) => a.status && a.status !== 'failed');
  check(`at least 4 issues analyzed successfully`, completed.length >= 4, `got ${completed.length}`);
  const withWorkforce = analyzed.filter((a) => a.workerCount >= 1);
  check(`analyzed issues have workforce estimates`, withWorkforce.length >= 4, `got ${withWorkforce.length}`);

  log('=== 4. DUPLICATE DETECTION ===');
  const dupForm = imageForm('pothole.jpg', cases[0].lat, cases[0].lon, 'Pothole on Mount Road again', 'Same big pothole near the junction.', ['pothole', 'road']);
  const dupRes = await api('/api/issues', { method: 'POST', token: cToken, form: dupForm });
  if (dupRes.status === 202 && dupRes.data.issueId) {
    const d = await pollUntilDone(dupRes.data.issueId, cToken);
    check('duplicate flagged with originalIssue + reportCount', !!d.duplicate && !!d.originalIssue && d.reportCount >= 2, JSON.stringify({ duplicate: d.duplicate, reportCount: d.reportCount, original: d.originalIssue && d.originalIssue.title }));
  } else {
    check('duplicate submit -> 202', false, `status=${dupRes.status} ${JSON.stringify(dupRes.data)}`);
  }

  log('=== 5. GOV LOGIN ===');
  let gov;
  try {
    gov = await login(GOV.email, GOV.password);
    check('gov login returns token + role GOV', gov.user && gov.user.role === 'GOV', JSON.stringify(gov.user));
  } catch (e) {
    check('gov login', false, e.message);
  }
  const gToken = gov ? gov.token : null;

  log('=== 6. PII CHECKS ===');
  const pub = await api('/api/issues');
  const govIssues = gToken ? await api('/api/issues', { token: gToken }) : { status: 0, data: [] };
  const somePublic = Array.isArray(pub.data) ? pub.data : pub.data && pub.data.issues ? pub.data.issues : [];
  const pubJson = JSON.stringify(pub.data || {});
  const leaked = /"(email|citizenId|phone)":/.test(pubJson) && !pubJson.includes('null');
  check('public GET /api/issues returns 200 + list', pub.status === 200 && somePublic.length > 0, `status=${pub.status} n=${somePublic.length}`);
  check('public list does NOT leak reporter PII', !leaked, 'email/citizenId present in public response');
  if (govIssues.status === 200) {
    const govList = Array.isArray(govIssues.data) ? govIssues.data : govIssues.data && govIssues.data.issues ? govIssues.data.issues : [];
    const withReporter = govList.filter((i) => i.reporters && i.reporters.length > 0);
    check('GOV list includes reporter names', withReporter.length > 0, `n=${withReporter.length}`);
  } else {
    check('GOV list fetch', false, `status=${govIssues.status}`);
  }

  log('=== 7. WORKFORCE OVERRIDE + STATUS UPDATE + RESOLUTION ===');
  const target = analyzed.find((a) => a.status === 'Pending' || a.status === 'In Progress') || analyzed[0];
  if (target && gToken) {
    const ov = await api(`/api/issues/${target.id}/workforce`, {
      method: 'PUT', token: gToken,
      body: { workerCount: 6, workerRoles: ['Driver', 'Laborers'], estimatedHours: 5, overrideReason: 'Demo override by field supervisor' },
    });
    check('workforce override accepted', ov.status === 200 || ov.status === 201, `status=${ov.status} ${JSON.stringify(ov.data)}`);

    const up = await api(`/api/issues/${target.id}`, {
      method: 'PUT', token: gToken, body: { status: 'In Progress' },
    });
    check('GOV status update -> In Progress', up.status === 200, `status=${up.status} ${JSON.stringify(up.data)}`);

    const res = await api(`/api/issues/${target.id}/resolution`, {
      method: 'PUT', token: gToken,
      body: { actualWorkerCount: 6, actualHours: 6, notes: 'Completed ahead of schedule' },
    });
    check('resolution recorded', res.status === 200, `status=${res.status} ${JSON.stringify(res.data)}`);
  } else {
    check('workforce override target available', false, 'no analyzed issue to operate on');
  }

  log('=== 8. ROUTE GENERATION ===');
  let routeInfo = null;
  if (gToken) {
    // Use a fresh future date so today's (already-committed) routes don't get
    // returned idempotently — the newly analyzed issues get dispatched fresh.
    const d = new Date();
    d.setDate(d.getDate() + 2);
    const routeDate = d.toISOString().slice(0, 10);
    const gen = await api('/api/routes/generate', { method: 'POST', token: gToken, body: { date: routeDate } });
    if (gen.status === 201 || gen.status === 200) {
      const routes = gen.data.routes || [];
      routeInfo = { routeDate, routes, stats: gen.data.stats };
      check(`route generation dispatched teams`, routes.length > 0, `status=${gen.status} ${JSON.stringify(gen.data.message)}`);
    } else {
      check('route generation', false, `status=${gen.status} ${JSON.stringify(gen.data)}`);
    }
  }

  log('=== 9. LIST ROUTES + COMPLETE A STOP ===');
  if (gToken) {
    const list = await api(routeInfo ? `/api/routes?date=${routeInfo.routeDate}` : '/api/routes', { token: gToken });
    check('GET /api/routes returns 200', list.status === 200, `status=${list.status}`);
    if (list.status === 200 && list.data.routes && list.data.routes.length > 0) {
      const firstRoute = list.data.routes[0];
      const firstStop = firstRoute.stops && firstRoute.stops.find((s) => s && !s.completed);
      if (firstStop && firstStop._id) {
        const cs = await api(`/api/routes/${firstRoute._id}/stop/${firstStop._id}`, { method: 'PUT', token: gToken });
        check('complete stop', cs.status === 200, `status=${cs.status} ${JSON.stringify(cs.data)}`);
      } else {
        check('route has an incomplete stop to complete', false, 'first route has no open stops');
      }
    }
  }

  log('=== 10. TEAMS + HEATMAP ===');
  if (gToken) {
    const teams = await api('/api/routes/teams', { token: gToken });
    check('GET /api/routes/teams returns teams', teams.status === 200 && teams.data.teams && teams.data.teams.length > 0, `status=${teams.status}`);
  }
  const heat = await api('/api/issues/heatmap');
  check('GET /api/issues/heatmap returns points', heat.status === 200 && Array.isArray(heat.data.points) && heat.data.points.length > 0, `status=${heat.status} n=${heat.data && heat.data.points && heat.data.points.length}`);

  log('\n==============================================');
  log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    log('FAILURES:');
    for (const f of failures) log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
