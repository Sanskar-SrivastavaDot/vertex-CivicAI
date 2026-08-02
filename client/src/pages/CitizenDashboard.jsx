import { useEffect, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchIssues } from '../utils/api';
import Spinner from '../components/Spinner';
import LocationName from '../components/LocationName';

// ── Constants ──────────────────────────────────────────────────────────────────
const CATEGORY_MAP = {
  'Road & Traffic':   { icon: '🛣️', color: 'bg-orange-50 text-orange-700 ring-orange-200' },
  'Water & Drainage': { icon: '💧', color: 'bg-blue-50 text-blue-700 ring-blue-200' },
  'Electricity':      { icon: '⚡', color: 'bg-yellow-50 text-yellow-700 ring-yellow-200' },
  'Sanitation':       { icon: '🗑️', color: 'bg-green-50 text-green-700 ring-green-200' },
  'Public Property':  { icon: '🏗️', color: 'bg-purple-50 text-purple-700 ring-purple-200' },
  'Other':            { icon: '📋', color: 'bg-slate-50 text-slate-600 ring-slate-200' },
};

const STATUS_CONFIG = {
  'Pending':     { bg: 'bg-red-50',     text: 'text-red-700',     ring: 'ring-red-200',     dot: '#ef4444', label: '⏳ Pending' },
  'In Progress': { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-200',   dot: '#f59e0b', label: '🔧 In Progress' },
  'Resolved':    { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', dot: '#22c55e', label: '✅ Resolved' },
};

const PRIORITY_CONFIG = {
  High:   { bg: 'bg-red-50',    text: 'text-red-700',    label: '🔴 High' },
  Medium: { bg: 'bg-amber-50',  text: 'text-amber-700',  label: '🟠 Medium' },
  Low:    { bg: 'bg-green-50',  text: 'text-green-700',  label: '🟢 Low' },
};

const TABS = ['All Issues', 'Pending', 'In Progress', 'Resolved'];

// ── Sub-components ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG['Pending'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text} ring-1 ${c.ring}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const c = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.Low;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text} ring-1 ring-inset ring-black/5`}>
      {c.label}
    </span>
  );
}

// ── Issue Card — READ ONLY ─────────────────────────────────────────────────────
function IssueCard({ issue }) {
  const cat = CATEGORY_MAP[issue.category] || CATEGORY_MAP['Other'];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
      {/* Priority stripe */}
      <div className={`h-1 ${issue.priority === 'High' ? 'bg-red-500' : issue.priority === 'Medium' ? 'bg-amber-400' : 'bg-emerald-400'}`} />

      {/* Image */}
      <div className="relative h-44 bg-slate-100 overflow-hidden">
        <img
          src={issue.imageUrl}
          alt="Issue"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={e => {
            e.target.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect fill='%23f1f5f9' width='100' height='100'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-size='32'>🏙️</text></svg>";
          }}
        />
        {/* Report count pill */}
        {(issue.reportCount || 1) > 1 && (
          <div className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-lg shadow">
            🔁 {issue.reportCount} reports
          </div>
        )}
        {/* Category pill */}
        <div className={`absolute bottom-2 left-2 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${cat.color} bg-white/90 backdrop-blur-sm`}>
          {cat.icon} {issue.category}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Title */}
        <div className="font-semibold text-slate-900 text-sm leading-snug line-clamp-2">
          {issue.title || issue.description?.slice(0, 80) + '…'}
        </div>

        {/* Description (truncated) */}
        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
          {issue.description}
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={issue.status} />
          <PriorityBadge priority={issue.priority} />
        </div>

        {/* AI Analysis panel */}
        {(issue.aiAnalysis?.workerRoles?.length > 0 || issue.workforceEstimation?.workerCount) && (
          <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">🤖 AI Analysis</span>
              {issue.aiAnalysis?.confidence > 0 && (
                <span className="text-[10px] font-semibold text-indigo-400">
                  {Math.round(issue.aiAnalysis.confidence * 100)}% confidence
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {issue.aiAnalysis?.severity && (
                <span className="bg-white border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                  Severity: {issue.aiAnalysis.severity}
                </span>
              )}
              {issue.aiAnalysis?.complexity && (
                <span className="bg-white border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                  Complexity: {issue.aiAnalysis.complexity}
                </span>
              )}
              {issue.workforceEstimation?.workerCount && (
                <span className="bg-white border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                  ~{issue.workforceEstimation.workerCount} workers · {issue.workforceEstimation.estimatedHours}h
                </span>
              )}
            </div>
            {issue.aiAnalysis?.workerRoles?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {issue.aiAnalysis.workerRoles.slice(0, 4).map(r => (
                  <span key={r} className="text-[10px] bg-white border border-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
                    {r}
                  </span>
                ))}
              </div>
            )}
            {issue.aiAnalysis?.damageArea > 0 && (
              <div className="text-[10px] text-indigo-500 font-medium">
                Estimated area: {issue.aiAnalysis.damageArea} {issue.aiAnalysis.damageUnit || 'sqm'}
              </div>
            )}
          </div>
        )}

        {/* Meta */}
        <div className="pt-1 border-t border-slate-100 flex flex-col gap-1">
          <div className="text-xs text-slate-400">
            <LocationName lat={issue.latitude} lng={issue.longitude} />
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-1">
            🗓️ {new Date(issue.createdAt).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric'
            })}
          </div>
        </div>

        {/* Read-only notice */}
        <div className="flex items-center gap-1.5 bg-slate-50 rounded-xl px-3 py-2">
          <span className="text-slate-400 text-xs">🔒</span>
          <span className="text-xs text-slate-400 font-medium">View only — status managed by authorities</span>
        </div>
      </div>
    </div>
  );
}

// ── Mini Map ───────────────────────────────────────────────────────────────────
function IssueMap({ issues }) {
  const withCoords = issues.filter(i => i.latitude && i.longitude);
  const centre = withCoords.length > 0
    ? [withCoords[0].latitude, withCoords[0].longitude]
    : [20.5937, 78.9629];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">🗺️ Issues Map</h2>
          <p className="text-xs text-slate-400 mt-0.5">{withCoords.length} pinned locations</p>
        </div>
        <div className="flex gap-3 text-xs text-slate-500">
          {Object.entries(STATUS_CONFIG).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.dot }} />
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="h-64">
        <MapContainer center={centre} zoom={5} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {withCoords.map(issue => (
            <CircleMarker
              key={issue._id}
              center={[issue.latitude, issue.longitude]}
              radius={8}
              pathOptions={{
                color: STATUS_CONFIG[issue.status]?.dot || '#94a3b8',
                fillColor: STATUS_CONFIG[issue.status]?.dot || '#94a3b8',
                fillOpacity: 0.8,
                weight: 2,
              }}
            >
              <Popup maxWidth={240}>
                <div className="text-sm space-y-1 py-1">
                  <div className="font-bold text-slate-900">{issue.title || 'Civic Issue'}</div>
                  <div className="text-xs text-slate-500">{CATEGORY_MAP[issue.category]?.icon} {issue.category}</div>
                  <div className="text-xs text-slate-600 leading-snug">{issue.description?.slice(0, 80)}…</div>
                  <div className="flex gap-1 mt-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CONFIG[issue.status]?.bg} ${STATUS_CONFIG[issue.status]?.text}`}>
                      {issue.status}
                    </span>
                  </div>
                  <LocationName lat={issue.latitude} lng={issue.longitude} className="text-xs text-slate-400 block mt-1" />
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

// ── Main CitizenDashboard ──────────────────────────────────────────────────────
export default function CitizenDashboard() {
  const [issues,  setIssues]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [activeTab, setActiveTab]     = useState('All Issues');
  const [search,    setSearch]        = useState('');
  const [filterPriority, setPriority] = useState('All');
  const [filterCategory, setCategory] = useState('All');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchIssues();
      setIssues(data.issues || []);
    } catch {
      setError('Failed to load issues. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Stats ──
  const stats = useMemo(() => ({
    total:      issues.length,
    pending:    issues.filter(i => i.status === 'Pending').length,
    inProgress: issues.filter(i => i.status === 'In Progress').length,
    resolved:   issues.filter(i => i.status === 'Resolved').length,
    totalRpts:  issues.reduce((s, i) => s + (i.reportCount || 1), 0),
  }), [issues]);

  // ── Filtered list ──
  const filtered = useMemo(() => {
    let list = issues;
    if (activeTab !== 'All Issues') list = list.filter(i => i.status === activeTab);
    if (search)         list = list.filter(i => (i.title || i.description || '').toLowerCase().includes(search.toLowerCase()));
    if (filterPriority !== 'All') list = list.filter(i => i.priority === filterPriority);
    if (filterCategory !== 'All') list = list.filter(i => i.category === filterCategory);
    return list;
  }, [issues, activeTab, search, filterPriority, filterCategory]);

  const categories = useMemo(() => ['All', ...Object.keys(CATEGORY_MAP)], []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">📋 Grievance Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">View all reported civic issues and their resolution status</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full ring-1 ring-blue-200">
            👁️ Read-only View
          </span>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { icon: '📋', label: 'Total Issues',  value: stats.total,      bg: 'bg-blue-50',    text: 'text-blue-700' },
            { icon: '🔁', label: 'Total Reports', value: stats.totalRpts,  bg: 'bg-purple-50',  text: 'text-purple-700' },
            { icon: '⏳', label: 'Pending',        value: stats.pending,   bg: 'bg-red-50',     text: 'text-red-600' },
            { icon: '🔧', label: 'In Progress',    value: stats.inProgress,bg: 'bg-amber-50',   text: 'text-amber-700' },
            { icon: '✅', label: 'Resolved',       value: stats.resolved,  bg: 'bg-emerald-50', text: 'text-emerald-700' },
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
      {!loading && !error && issues.length > 0 && <IssueMap issues={issues} />}

      {/* ── Main Panel ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {TABS.map(tab => {
            const count = tab === 'All Issues' ? issues.length : issues.filter(i => i.status === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="px-5 py-3 bg-slate-50/60 border-b border-slate-100 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search issues…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all"
            />
          </div>
          <select
            value={filterPriority}
            onChange={e => setPriority(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 outline-none text-slate-700 font-medium"
          >
            {['All', 'High', 'Medium', 'Low'].map(v => <option key={v}>{v === 'All' ? 'All Priorities' : v}</option>)}
          </select>
          <select
            value={filterCategory}
            onChange={e => setCategory(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 outline-none text-slate-700 font-medium"
          >
            {categories.map(c => <option key={c}>{c === 'All' ? 'All Categories' : c}</option>)}
          </select>
          <span className="text-xs text-slate-400 font-medium ml-auto">
            {filtered.length} issue{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Content */}
        <div className="p-5">
          {loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" text="Loading issues…" />
            </div>
          ) : error ? (
            <div className="py-20 text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <p className="text-slate-600 font-medium mb-3">{error}</p>
              <button onClick={load} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
                Try Again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <div className="text-4xl mb-3">📭</div>
              <p className="font-semibold text-slate-700">No issues found</p>
              <p className="text-sm text-slate-400 mt-1">Try changing the filters or check back later</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map(issue => (
                <IssueCard key={issue._id} issue={issue} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
