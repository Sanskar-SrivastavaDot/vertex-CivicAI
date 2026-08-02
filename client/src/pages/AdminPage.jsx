import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchIssues, updateIssueStatus, overrideWorkforce, recordResolution } from '../utils/api';
import { formatCitizenId } from '../utils/auth';
import Spinner from '../components/Spinner';
import LocationName from '../components/LocationName';
import RoutePlanner from '../components/RoutePlanner';
import TeamManager from '../components/TeamManager';

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_FLOW   = ['Pending', 'In Progress', 'Resolved'];
const TABS          = ['All', 'Pending', 'In Progress', 'Resolved'];
const PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };

const CATEGORY_MAP = {
  'Road & Traffic':   { icon: '🛣️' },
  'Water & Drainage': { icon: '💧' },
  'Electricity':      { icon: '⚡' },
  'Sanitation':       { icon: '🗑️' },
  'Public Property':  { icon: '🏗️' },
  'Other':            { icon: '📋' },
};

const STATUS_COLORS = {
  'Pending':    { marker: '#ef4444', bg: 'bg-red-50',    text: 'text-red-700',    ring: 'ring-red-600/20',    dot: '#ef4444' },
  'In Progress':{ marker: '#f59e0b', bg: 'bg-amber-50',  text: 'text-amber-700',  ring: 'ring-amber-600/20',  dot: '#f59e0b' },
  'Resolved':   { marker: '#22c55e', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-600/20',dot: '#22c55e' },
};

const PRIORITY_COLORS = {
  High:   { bg: 'bg-red-50',    text: 'text-red-700',    ring: 'ring-red-600/20' },
  Medium: { bg: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-600/20' },
  Low:    { bg: 'bg-green-50',  text: 'text-green-700',  ring: 'ring-green-600/20' },
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function nextStatus(current) {
  const idx = STATUS_FLOW.indexOf(current);
  return idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
}
function priorityScore(issue) {
  return (issue.reportCount || 1) * (PRIORITY_WEIGHT[issue.priority] || 1);
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS['Pending'];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text} ring-1 ${c.ring}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
      {status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS.Low;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text} ring-1 ${c.ring}`}>
      {priority}
    </span>
  );
}

// ── Citizen Details Modal ──────────────────────────────────────────────────────
function CitizenModal({ issue, onClose }) {
  if (!issue) return null;
  // All reporters: deduplicate by id
  const reporters = issue.reporters?.length
    ? issue.reporters
    : issue.createdBy ? [issue.createdBy] : [];

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-20 bg-gradient-to-r from-indigo-600 to-blue-700 flex items-end px-6 pb-3">
          <h2 className="text-white font-bold text-lg">👥 Reporters ({reporters.length})</h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* All reporters list */}
          {reporters.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No citizen data available</p>
          ) : reporters.map((citizen, idx) => (
            <div key={citizen?._id || idx} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-lg flex-shrink-0">👤</div>
                <div>
                  <div className="font-semibold text-slate-900 text-sm">{citizen?.name || 'Unknown'}</div>
                  <span className="font-mono text-xs bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-500">
                    {formatCitizenId(citizen?._id || '', citizen?.citizenId || '')}
                  </span>
                  {idx === 0 && (
                    <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">Original Reporter</span>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Row icon="📧" label="Email"   value={citizen?.email || '—'} />
                <Row icon="📱" label="Phone"   value={citizen?.profileDetails?.phone || '—'} />
                <Row icon="🏠" label="Address" value={citizen?.profileDetails?.address || '—'} />
              </div>
            </div>
          ))}

          {/* Issue summary */}
          <div className="pt-4 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Issue Summary</p>
            <div className="flex gap-2 flex-wrap mb-2">
              <StatusBadge status={issue.status} />
              <PriorityBadge priority={issue.priority} />
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                {CATEGORY_MAP[issue.category]?.icon} {issue.category}
              </span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{issue.description}</p>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-semibold text-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="text-base">{icon}</span>
      <div>
        <div className="text-xs text-slate-400 font-medium">{label}</div>
        <div className="text-slate-800 font-medium">{value}</div>
      </div>
    </div>
  );
}

// ── Issue Card (Active issues — Pending & In Progress) ─────────────────────────
function IssueCard({ issue, onAdvance, isUpdating, onViewCitizen, onOverride }) {
  const next  = nextStatus(issue.status);
  const score = priorityScore(issue);
  const sc    = STATUS_COLORS[issue.status] || STATUS_COLORS['Pending'];
  const citizen = issue.createdBy;
  const wf = issue.workforceEstimation;

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow group`}>
      {/* Priority stripe */}
      <div className={`h-1 w-full ${issue.priority === 'High' ? 'bg-red-500' : issue.priority === 'Medium' ? 'bg-amber-400' : 'bg-emerald-400'}`} />

      {/* Image */}
      <div className="relative h-40 bg-slate-100 overflow-hidden">
        <img
          src={issue.imageUrl}
          alt="Issue"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={e => {
            e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23f1f5f9" width="100" height="100"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-size="32">🏙️</text></svg>';
          }}
        />
        {/* Score */}
        <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm text-slate-700 text-xs font-bold px-2 py-1 rounded-lg shadow-sm">
          ⚖️ Score {score}
        </div>
        {/* Report count */}
        {(issue.reportCount || 1) > 1 && (
          <div className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-lg shadow-sm animate-pulse">
            🔁 {issue.reportCount}x
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Title & category */}
        <div>
          <div className="font-semibold text-slate-900 text-sm leading-snug mb-1">
            {issue.title || 'Civic Issue'}
          </div>
          <div className="text-xs text-slate-500 mb-1.5">
            {CATEGORY_MAP[issue.category]?.icon} {issue.category}
          </div>
          {/* Description */}
          <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 bg-slate-50 rounded-lg px-2.5 py-2 border border-slate-100">
            {issue.description || '—'}
          </p>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={issue.status} />
          <PriorityBadge priority={issue.priority} />
        </div>

        {/* Reporters row */}
        <div className="bg-slate-50 rounded-xl px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">👥</span>
              <span className="text-xs font-semibold text-slate-700">
                {issue.reporters?.length > 0
                  ? `${issue.reporters.length} reporter${issue.reporters.length > 1 ? 's' : ''}`
                  : citizen ? '1 reporter' : 'No reporter'}
              </span>
              {/* Avatar stack */}
              {(issue.reporters || (citizen ? [citizen] : [])).slice(0, 3).map((r, i) => (
                <div key={r?._id || i}
                  className="w-5 h-5 rounded-full bg-indigo-200 border border-white flex items-center justify-center text-[10px] -ml-1 first:ml-0"
                  title={r?.name}
                >👤</div>
              ))}
              {(issue.reporters?.length || 0) > 3 && (
                <span className="text-xs text-slate-400">+{issue.reporters.length - 3}</span>
              )}
            </div>
            <button
              onClick={() => onViewCitizen(issue)}
              className="text-xs text-indigo-600 font-semibold hover:text-indigo-800 transition-colors bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg"
            >
              View All
            </button>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-col gap-0.5 text-xs text-slate-400">
          <LocationName lat={issue.latitude} lng={issue.longitude} className="truncate max-w-full" />
          <span>🗓️ {new Date(issue.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>

        {/* AI Workforce Estimate */}
        {wf?.workerCount && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">🤖 AI Workforce Estimate</span>
              <span className="text-[10px] font-semibold text-indigo-400">
                {(wf.confidence || 0) > 0 ? `${Math.round(wf.confidence * 100)}% conf` : ''}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-indigo-800">
              <span className="font-bold text-base">{wf.workerCount} workers</span>
              <span className="text-indigo-400">·</span>
              <span>~{wf.estimatedHours} hrs</span>
              {wf.overriddenBy && (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">overridden</span>
              )}
            </div>
            {wf.workerRoles?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {wf.workerRoles.slice(0, 3).map(r => (
                  <span key={r} className="text-[10px] bg-white border border-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
                    {r}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={() => onOverride(issue)}
              className="mt-2 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
            >
              Adjust Estimate
            </button>
          </div>
        )}

        {/* Action */}
        <div>
          {next ? (
            <button
              className="w-full py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              onClick={() => onAdvance(issue)}
              disabled={isUpdating}
            >
              {isUpdating ? <><Spinner size="sm" /> Updating…</> : `→ Mark ${next}`}
            </button>
          ) : (
            <div className="w-full py-2 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-700 text-center ring-1 ring-emerald-600/20">
              ✅ Completed
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Resolved Card ──────────────────────────────────────────────────────────────
function ResolvedCard({ issue, onViewCitizen }) {
  const reporters = issue.reporters?.length
    ? issue.reporters
    : issue.createdBy ? [issue.createdBy] : [];

  return (
    <div className="bg-white rounded-2xl border border-emerald-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
      {/* Resolved stripe */}
      <div className="h-1 bg-emerald-400" />

      {/* Image */}
      <div className="relative h-40 bg-slate-100 overflow-hidden">
        <img
          src={issue.imageUrl}
          alt="Resolved Issue"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={e => {
            e.target.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect fill='%23f0fdf4' width='100' height='100'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2386efac' font-size='32'>✅</text></svg>";
          }}
        />
        <div className="absolute top-2 left-2 bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-lg shadow">
          ✅ Resolved
        </div>
        {(issue.reportCount || 1) > 1 && (
          <div className="absolute top-2 right-2 bg-slate-800/80 text-white text-xs font-bold px-2 py-1 rounded-lg">
            🔁 {issue.reportCount} reports
          </div>
        )}
        <div className="absolute bottom-2 left-2 bg-white/90 backdrop-blur-sm text-xs font-semibold px-2 py-1 rounded-lg text-slate-600">
          {CATEGORY_MAP[issue.category]?.icon} {issue.category}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Title */}
        <div className="font-semibold text-slate-900 text-sm leading-snug">
          {issue.title || 'Civic Issue'}
        </div>

        {/* Description */}
        <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 bg-slate-50 rounded-lg px-2.5 py-2 border border-slate-100">
          {issue.description || '—'}
        </p>

        {/* Resolution date & priority */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <PriorityBadge priority={issue.priority} />
          <span className="text-xs text-slate-400">
            🗓️ Resolved {new Date(issue.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>

        {/* Reporters */}
        <div className="bg-emerald-50 rounded-xl px-3 py-2 flex items-center justify-between border border-emerald-100">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">👥</span>
            <span className="text-xs font-semibold text-emerald-700">
              {reporters.length} reporter{reporters.length !== 1 ? 's' : ''}
            </span>
            {reporters.slice(0, 3).map((r, i) => (
              <div key={r?._id || i}
                className="w-5 h-5 rounded-full bg-emerald-200 border border-white flex items-center justify-center text-[10px] -ml-1 first:ml-0"
                title={r?.name}
              >👤</div>
            ))}
          </div>
          <button
            onClick={() => onViewCitizen(issue)}
            className="text-xs text-emerald-700 font-semibold bg-emerald-100 hover:bg-emerald-200 px-2 py-1 rounded-lg transition-colors"
          >
            View All
          </button>
        </div>

        {/* Location */}
        <div className="text-xs text-slate-400">
          <LocationName lat={issue.latitude} lng={issue.longitude} />
        </div>
      </div>
    </div>
  );
}

// ── Map Section ────────────────────────────────────────────────────────────────
function IssueMap({ issues }) {
  const [mapFilter, setMapFilter] = useState('All');
  const centre = [20.5937, 78.9629]; // India centroid

  const visible = useMemo(() =>
    mapFilter === 'All' ? issues : issues.filter(i => i.status === mapFilter),
    [issues, mapFilter]
  );

  const hasCoords = visible.filter(i => i.latitude && i.longitude);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">🗺️ Grievance Map</h2>
          <p className="text-xs text-slate-400 mt-0.5">{hasCoords.length} locations visible</p>
        </div>
        <div className="flex gap-2">
          {['All', 'Pending', 'In Progress', 'Resolved'].map(f => (
            <button
              key={f}
              onClick={() => setMapFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mapFilter === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="px-6 py-2 bg-slate-50 border-b border-slate-100 flex gap-4 text-xs text-slate-600">
        {Object.entries(STATUS_COLORS).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: c.marker }} />
            {s}
          </span>
        ))}
      </div>

      {/* Map */}
      <div className="h-80">
        <MapContainer
          center={centre}
          zoom={5}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {hasCoords.map(issue => (
            <CircleMarker
              key={issue._id}
              center={[issue.latitude, issue.longitude]}
              radius={10}
              pathOptions={{
                color: STATUS_COLORS[issue.status]?.marker || '#94a3b8',
                fillColor: STATUS_COLORS[issue.status]?.marker || '#94a3b8',
                fillOpacity: 0.85,
                weight: 2,
              }}
            >
              <Popup maxWidth={280}>
                <div className="text-sm space-y-1 py-1">
                  <div className="font-bold text-slate-900">{issue.title || 'Civic Issue'}</div>
                  <div className="text-slate-500">{CATEGORY_MAP[issue.category]?.icon} {issue.category}</div>
                  <div className="text-slate-600 text-xs leading-snug">{issue.description?.slice(0, 100)}…</div>
                  <div className="flex gap-1.5 mt-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[issue.status]?.bg} ${STATUS_COLORS[issue.status]?.text}`}>
                      {issue.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    <LocationName lat={issue.latitude} lng={issue.longitude} className="block" />
                    🗓️ {new Date(issue.createdAt).toLocaleDateString()}
                  </div>
                  {issue.createdBy && (
                    <div className="text-xs text-slate-500 border-t border-slate-100 pt-1 mt-1">
                      👤 {issue.createdBy.name || 'Citizen'} · {formatCitizenId(issue.createdBy._id || '', issue.createdBy.citizenId || '')}
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

// ── Workforce Override Modal ───────────────────────────────────────────────────
function OverrideModal({ issue, onClose, onSaved }) {
  const wf = issue.workforceEstimation || {};
  const [workerCount, setWorkerCount] = useState(wf.workerCount || 3);
  const [estimatedHours, setEstimatedHours] = useState(wf.estimatedHours || 2);
  const [overrideReason, setOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await overrideWorkforce(issue._id, {
        workerCount: Number(workerCount),
        estimatedHours: Number(estimatedHours),
        overrideReason,
      });
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to override estimate.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-16 bg-gradient-to-r from-indigo-600 to-blue-700 flex items-end px-6 pb-3">
          <h2 className="text-white font-bold text-lg">🤖 Adjust Workforce Estimate</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-500">{issue.title || 'Civic Issue'} — override the AI recommendation based on ground truth.</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workers</label>
              <input
                type="number"
                min={1}
                max={50}
                value={workerCount}
                onChange={e => setWorkerCount(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Hours</label>
              <input
                type="number"
                min={0.5}
                max={48}
                step={0.5}
                value={estimatedHours}
                onChange={e => setEstimatedHours(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reason (optional)</label>
            <textarea
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              rows={2}
              placeholder="e.g. Site inspection showed larger repair area"
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-semibold text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-xl text-sm font-semibold text-white transition-colors"
            >
              {saving ? 'Saving…' : 'Save Override'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Resolution Modal (records actuals for historical learning) ────────────────
function ResolutionModal({ issue, onClose, onSaved }) {
  const wf = issue.workforceEstimation || {};
  const [actualWorkerCount, setActualWorkerCount] = useState(wf.workerCount || 3);
  const [actualHours, setActualHours] = useState(wf.estimatedHours || 2);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await recordResolution(issue._id, {
        actualWorkerCount: Number(actualWorkerCount),
        actualHours: Number(actualHours),
        notes,
      });
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record resolution.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-16 bg-gradient-to-r from-emerald-600 to-green-700 flex items-end px-6 pb-3">
          <h2 className="text-white font-bold text-lg">✅ Mark Resolved</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-500">
            Record what it actually took to fix this issue. Real data trains future AI estimates.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Workers Used</label>
              <input
                type="number"
                min={1}
                max={50}
                value={actualWorkerCount}
                onChange={e => setActualWorkerCount(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Hours Taken</label>
              <input
                type="number"
                min={0.5}
                max={72}
                step={0.5}
                value={actualHours}
                onChange={e => setActualHours(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="What work was done?"
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-semibold text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl text-sm font-semibold text-white transition-colors"
            >
              {saving ? 'Saving…' : 'Resolve Issue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main AdminPage ─────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [issues,     setIssues]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [activeTab,  setActiveTab]  = useState('All');
  const [search,     setSearch]     = useState('');
  const [filterPriority, setFilterPriority] = useState('All');
  const [citizenModal, setCitizenModal]     = useState(null); // issue object
  const [overrideModal, setOverrideModal]   = useState(null); // issue object
  const [resolutionModal, setResolutionModal] = useState(null); // issue object

  // ── Load issues (with populate of createdBy) ──
  const loadIssues = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchIssues({ populate: 'createdBy' });
      setIssues(data.issues || []);
    } catch {
      setError('Failed to load grievances from the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadIssues(); }, [loadIssues]);

  const refreshIssues = async () => {
    await loadIssues();
    setOverrideModal(null);
    setResolutionModal(null);
  };

  // ── Status advance (Resolved opens the resolution modal first) ──
  const handleAdvance = async (issue) => {
    const next = nextStatus(issue.status);
    if (!next) return;
    if (next === 'Resolved') {
      setResolutionModal(issue);
      return;
    }
    try {
      setUpdatingId(issue._id);
      await updateIssueStatus(issue._id, next);
      setIssues(prev => prev.map(i => i._id === issue._id ? { ...i, status: next } : i));
    } catch {
      alert('Failed to update status. Please try again.');
    } finally {
      setUpdatingId(null);
    }
  };

  // ── Derived data ──
  const stats = useMemo(() => ({
    total:      issues.length,
    totalRpts:  issues.reduce((s, i) => s + (i.reportCount || 1), 0),
    pending:    issues.filter(i => i.status === 'Pending').length,
    inProgress: issues.filter(i => i.status === 'In Progress').length,
    resolved:   issues.filter(i => i.status === 'Resolved').length,
    high:       issues.filter(i => i.priority === 'High').length,
  }), [issues]);

  // Active issues (non-resolved), sorted by priority score
  const activeIssues = useMemo(() =>
    issues
      .filter(i => i.status !== 'Resolved')
      .sort((a, b) => priorityScore(b) - priorityScore(a)),
    [issues]
  );

  const resolvedIssues = useMemo(() =>
    issues.filter(i => i.status === 'Resolved')
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    [issues]
  );

  // Filter active issues by tab, search, priority
  const filteredActive = useMemo(() => {
    let list = activeTab === 'Resolved' ? [] :
               activeTab === 'All'      ? activeIssues :
               activeIssues.filter(i => i.status === activeTab);

    if (search)                          list = list.filter(i => (i.title || i.description || '').toLowerCase().includes(search.toLowerCase()));
    if (filterPriority !== 'All')        list = list.filter(i => i.priority === filterPriority);
    return list;
  }, [activeIssues, activeTab, search, filterPriority]);

  // Cluster active filtered issues by category
  const clusters = useMemo(() => {
    const map = new Map();
    for (const issue of filteredActive) {
      const key = issue.category || 'Other';
      if (!map.has(key)) map.set(key, { icon: CATEGORY_MAP[key]?.icon || '📋', label: key, issues: [] });
      map.get(key).issues.push(issue);
    }
    return [...map.values()];
  }, [filteredActive]);

  // ── Render ──
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            🏛️ <span>Authority Dashboard</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Grievance Management Portal · Issues sorted by Priority Score</p>
        </div>
        <button
          onClick={loadIssues}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
        >
          🔄 Refresh
        </button>
      </div>

      {/* ── Stats Strip ── */}
      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { icon: '📋', label: 'Unique Issues',   value: stats.total,      bg: 'bg-blue-50',    text: 'text-blue-700' },
            { icon: '🔁', label: 'Total Reports',   value: stats.totalRpts,  bg: 'bg-purple-50',  text: 'text-purple-700' },
            { icon: '⏳', label: 'Pending',          value: stats.pending,   bg: 'bg-red-50',     text: 'text-red-600' },
            { icon: '🔧', label: 'In Progress',      value: stats.inProgress,bg: 'bg-amber-50',   text: 'text-amber-700' },
            { icon: '✅', label: 'Resolved',         value: stats.resolved,  bg: 'bg-emerald-50', text: 'text-emerald-700' },
            { icon: '🔴', label: 'High Priority',    value: stats.high,      bg: 'bg-slate-100',  text: 'text-slate-700' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-4 shadow-sm border border-white`}>
              <div className="text-xl mb-1">{s.icon}</div>
              <div className={`text-2xl font-bold ${s.text}`}>{s.value}</div>
              <div className="text-xs text-slate-500 font-medium">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Map ── */}
      {!loading && !error && <IssueMap issues={issues} />}

      {/* ── Route Optimizer ── */}
      {!loading && !error && <RoutePlanner />}

      {/* ── Field Teams & Workers ── */}
      {!loading && !error && <TeamManager />}

      {/* ── Tabs ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {TABS.map(tab => {
            const count = tab === 'All' ? activeIssues.length
                        : tab === 'Resolved' ? resolvedIssues.length
                        : activeIssues.filter(i => i.status === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === tab ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filter bar (active tabs only) */}
        {activeTab !== 'Resolved' && (
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[160px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search grievances…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all"
              />
            </div>
            <select
              value={filterPriority}
              onChange={e => setFilterPriority(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none text-slate-700 font-medium"
            >
              {['All', 'High', 'Medium', 'Low'].map(v => <option key={v}>{v}</option>)}
            </select>
            <span className="text-xs text-slate-400 font-medium">
              {filteredActive.length} issue{filteredActive.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="p-5">
          {loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" text="Loading grievances…" />
            </div>
          ) : error ? (
            <div className="py-20 text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <p className="text-slate-600 font-medium mb-3">{error}</p>
              <button onClick={loadIssues} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
                Try Again
              </button>
            </div>
          ) : activeTab === 'Resolved' ? (
            /* ── Resolved Issues Tab — Card Grid ── */
            resolvedIssues.length === 0 ? (
              <div className="py-20 text-center">
                <div className="text-4xl mb-3">📭</div>
                <p className="font-semibold text-slate-700">No resolved issues yet</p>
                <p className="text-sm text-slate-400 mt-1">Resolved grievances will appear here automatically</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {resolvedIssues.map(issue => (
                  <ResolvedCard
                    key={issue._id}
                    issue={issue}
                    onViewCitizen={setCitizenModal}
                  />
                ))}
              </div>
            )
          ) : filteredActive.length === 0 ? (
            <div className="py-20 text-center">
              <div className="text-4xl mb-3">📭</div>
              <p className="font-semibold text-slate-700">No grievances found</p>
              <p className="text-sm text-slate-400 mt-1">Adjust filters or wait for new reports</p>
            </div>
          ) : (
            /* ── Active Issues by Category ── */
            <div className="space-y-8">
              {clusters.map(cluster => (
                <div key={cluster.label}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xl">{cluster.icon}</span>
                    <h3 className="text-base font-bold text-slate-800">{cluster.label}</h3>
                    <span className="text-xs bg-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-full">
                      {cluster.issues.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {cluster.issues.map(issue => (
                      <IssueCard
                        key={issue._id}
                        issue={issue}
                        onAdvance={handleAdvance}
                        isUpdating={updatingId === issue._id}
                        onViewCitizen={setCitizenModal}
                        onOverride={setOverrideModal}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Citizen Details Modal ── */}
      {citizenModal && (
        <CitizenModal issue={citizenModal} onClose={() => setCitizenModal(null)} />
      )}

      {/* ── Workforce Override Modal ── */}
      {overrideModal && (
        <OverrideModal issue={overrideModal} onClose={() => setOverrideModal(null)} onSaved={refreshIssues} />
      )}

      {/* ── Resolution Modal ── */}
      {resolutionModal && (
        <ResolutionModal issue={resolutionModal} onClose={() => setResolutionModal(null)} onSaved={refreshIssues} />
      )}
    </div>
  );
}
