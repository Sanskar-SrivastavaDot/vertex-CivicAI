import { useState, useCallback, useEffect } from 'react';
import { CalendarDays, Route as RouteIcon, MapPin, CheckCircle2, Loader2, Users, Clock, TrendingUp } from 'lucide-react';
import { generateRoutes, getRoutes, completeStop, getTeams } from '../utils/api';
import Spinner from '../components/Spinner';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_STYLE = {
  'Planned':     { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-600/20', dot: '#3b82f6' },
  'In Progress': { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-600/20', dot: '#f59e0b' },
  'Completed':   { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-600/20', dot: '#22c55e' },
};

export default function RoutePlanner() {
  const [date, setDate] = useState(todayStr());
  const [routes, setRoutes] = useState([]);
  const [teams, setTeams] = useState([]);
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [completingId, setCompletingId] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const loadRoutes = useCallback(async (d = date) => {
    try {
      setLoadingRoutes(true);
      setError('');
      const data = await getRoutes({ date: d });
      setRoutes(data.routes || []);
    } catch (err) {
      setRoutes([]);
      setError(err.response?.data?.error || 'Could not load routes.');
    } finally {
      setLoadingRoutes(false);
    }
  }, [date]);

  const loadTeams = useCallback(async () => {
    try {
      const data = await getTeams();
      setTeams(data.teams || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadRoutes(); loadTeams(); }, [loadRoutes, loadTeams]);

  const handleGenerate = async () => {
    setGenerating(true);
    setMessage('');
    setError('');
    try {
      const data = await generateRoutes(date);
      setStats(data.stats || null);
      setMessage(data.message);
      setRoutes(data.routes || []);
      setError('');
    } catch (err) {
      setStats(null);
      setMessage('');
      setError(err.response?.data?.error || 'Route generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCompleteStop = async (routeId, stopId) => {
    setCompletingId(stopId);
    try {
      await completeStop(routeId, stopId);
      await loadRoutes();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not complete stop.');
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <RouteIcon className="w-5 h-5 text-indigo-600" />
            Daily Route Optimizer
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Auto-assign pending issues to field teams using nearest-depot + 2-opt routing
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <CalendarDays className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-700 outline-none"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Optimizing…</> : <>⚡ Generate Routes</>}
          </button>
        </div>
      </div>

      {/* Message / error / stats */}
      <div className="px-6 py-3 border-b border-slate-100 space-y-2">
        {message && !error && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            ✅ {message}
          </div>
        )}
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            ⚠️ {error}
          </div>
        )}
        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={<Users className="w-4 h-4" />} label="Teams Dispatched" value={stats.teamsDispatched} />
            <Stat icon={<MapPin className="w-4 h-4" />} label="Stops Planned" value={stats.stopsPlanned} />
            <Stat icon={<Clock className="w-4 h-4" />} label="Unassigned" value={stats.unassigned} />
          </div>
        )}
      </div>

      {/* Teams strip */}
      {teams.length > 0 && (
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/60">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Active Field Teams</p>
          <div className="flex flex-wrap gap-2">
            {teams.map(t => (
              <span key={t._id} className="inline-flex items-center gap-1.5 text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1 font-medium text-slate-700">
                <Users className="w-3.5 h-3.5 text-indigo-500" />
                {t.name} · {t.department}
                <span className="text-slate-400">({t.capacity?.maxWorkers} workers)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Routes list */}
      <div className="p-6">
        {loadingRoutes ? (
          <div className="py-10 flex justify-center"><Spinner size="md" text="Loading routes…" /></div>
        ) : routes.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-4xl mb-3">🗺️</div>
            <p className="font-semibold text-slate-700">No routes for {date}</p>
            <p className="text-sm text-slate-400 mt-1">Click "Generate Routes" to dispatch teams for the day</p>
          </div>
        ) : (
          <div className="space-y-4">
            {routes.map(route => {
              const sc = STATUS_STYLE[route.status] || STATUS_STYLE.Planned;
              const isExpanded = expanded === route._id;
              const doneStops = (route.stops || []).filter(s => s.completed).length;
              return (
                <div key={route._id} className="border border-slate-200 rounded-xl overflow-hidden">
                  {/* Route header */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : route._id)}
                    className="w-full flex flex-wrap items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0`} style={{ background: sc.dot }} />
                    <span className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-indigo-500" />
                      {route.team?.name || 'Team'}
                    </span>
                    <span className="text-xs text-slate-500">{route.team?.department}</span>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> {route.stops?.length || 0} stops
                    </span>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" /> {route.totalDistanceKm} km
                    </span>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {route.estimatedDurationLabel}
                    </span>
                    <span className={`ml-auto text-xs font-bold px-2.5 py-1 rounded-full ${sc.bg} ${sc.text} ring-1 ${sc.ring}`}>
                      {route.status}
                    </span>
                    <span className="text-xs text-slate-400">{doneStops}/{route.stops?.length || 0} done</span>
                  </button>

                  {/* Expanded stops */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {route.stops && route.stops.length > 0 ? route.stops.map((stop, idx) => {
                        const d = stop.issueDetails;
                        return (
                          <div key={stop._id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-[180px]">
                              <div className="text-sm font-medium text-slate-800">{d?.title || 'Civic Issue'}</div>
                              <div className="text-xs text-slate-400">
                                {d?.category} · {d?.priority} priority · {d?.workerCount || '—'} workers · {d?.estimatedHours || '—'}h
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                <LocationText d={d} />
                              </div>
                            </div>
                            {stop.completed ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Done
                              </span>
                            ) : (
                              <button
                                onClick={() => handleCompleteStop(route._id, stop._id)}
                                disabled={completingId === stop._id}
                                className="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 px-2.5 py-1 rounded-lg transition-colors"
                              >
                                {completingId === stop._id ? 'Marking…' : 'Mark Complete'}
                              </button>
                            )}
                          </div>
                        );
                      }) : (
                        <p className="px-4 py-3 text-sm text-slate-400">No stops on this route.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2">
      <span className="text-indigo-500">{icon}</span>
      <div>
        <div className="text-lg font-bold text-slate-800 leading-none">{value}</div>
        <div className="text-[10px] text-slate-400 font-medium">{label}</div>
      </div>
    </div>
  );
}

function LocationText({ d }) {
  if (d?.latitude && d?.longitude) {
    return `📍 ${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}`;
  }
  return null;
}
