import { useState, useCallback, useEffect } from 'react';
import {
  Users, MapPin, Phone, Loader2, Plus, Trash2, UserPlus, UserMinus, ChevronDown, ChevronUp,
} from 'lucide-react';
import { getTeams, createTeam, deleteTeam, getWorkers, createWorker, addTeamMember, removeTeamMember } from '../utils/api';
import Spinner from '../components/Spinner';

const DEPARTMENTS = ['Road & Traffic', 'Water & Drainage', 'Electricity', 'Sanitation', 'Public Property'];

const emptyForm = {
  name: '',
  department: 'Road & Traffic',
  maxWorkers: 6,
  maxHoursPerDay: 8,
  address: '',
  latitude: 13.0827,
  longitude: 80.2707,
};

const inputCls =
  'w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all';

export default function TeamManager() {
  const [teams, setTeams] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showWorker, setShowWorker] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selWorker, setSelWorker] = useState({});

  const [form, setForm] = useState(emptyForm);
  const [workerForm, setWorkerForm] = useState({ name: '', email: '', password: '', department: '' });

  const load = useCallback(async () => {
    try {
      setError('');
      const [teamData, workerData] = await Promise.all([getTeams(), getWorkers()]);
      setTeams(teamData.teams || []);
      setWorkers(workerData.workers || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load teams.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setWorkerField = (k) => (e) => setWorkerForm((f) => ({ ...f, [k]: e.target.value }));

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await createTeam({
        name: form.name.trim(),
        department: form.department,
        capacity: { maxWorkers: Number(form.maxWorkers), maxHoursPerDay: Number(form.maxHoursPerDay) },
        depot: {
          coordinates: [Number(form.longitude), Number(form.latitude)],
          address: form.address.trim(),
        },
      });
      setForm(emptyForm);
      setShowCreate(false);
      setMessage('Team created.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create team.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateWorker = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await createWorker({
        name: workerForm.name.trim(),
        email: workerForm.email.trim(),
        password: workerForm.password,
        department: workerForm.department || null,
      });
      setWorkerForm({ name: '', email: '', password: '', department: '' });
      setShowWorker(false);
      setMessage('Worker account created.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create worker.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (team) => {
    if (!window.confirm(`Deactivate "${team.name}"? Its route history stays intact.`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteTeam(team._id);
      setMessage(`Team "${team.name}" deactivated.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete team.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddMember = async (teamId, userId) => {
    setBusy(true);
    setError('');
    try {
      await addTeamMember(teamId, userId);
      setMessage('Worker assigned to team.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not assign worker.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (teamId, memberId) => {
    setBusy(true);
    setError('');
    try {
      await removeTeamMember(teamId, memberId);
      setMessage('Worker removed from team.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove worker.');
    } finally {
      setBusy(false);
    }
  };

  const memberIds = (team) => new Set((team.members || []).map((m) => m._id));
  const availableFor = (team) => workers.filter((w) => !memberIds(team).has(w._id));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            Field Teams & Workers
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Create work teams and assign GOV workers to each team</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setShowWorker(!showWorker); setShowCreate(false); }}
            className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Add Worker
          </button>
          <button
            onClick={() => { setShowCreate(!showCreate); setShowWorker(false); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Team
          </button>
        </div>
      </div>

      {/* Message / error */}
      <div className="px-6 py-3 border-b border-slate-100 space-y-2">
        {message && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">✅ {message}</div>
        )}
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">⚠️ {error}</div>
        )}
      </div>

      {/* Create team form */}
      {showCreate && (
        <form onSubmit={handleCreateTeam} className="px-6 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">New Field Team</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Users className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input required placeholder="Team name (e.g. Road Team 3)" value={form.name} onChange={setField('name')} className={inputCls} />
            </div>
            <select value={form.department} onChange={setField('department')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none text-slate-700 font-medium">
              {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
            </select>
            <div className="relative">
              <Phone className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input type="number" min="1" required placeholder="Max workers (capacity)" value={form.maxWorkers} onChange={setField('maxWorkers')} className={inputCls} />
            </div>
            <div className="relative">
              <Phone className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input type="number" min="1" required placeholder="Max hours / day" value={form.maxHoursPerDay} onChange={setField('maxHoursPerDay')} className={inputCls} />
            </div>
            <div className="relative sm:col-span-2">
              <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input placeholder="Depot address" value={form.address} onChange={setField('address')} className={inputCls} />
            </div>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input type="number" step="any" required placeholder="Latitude" value={form.latitude} onChange={setField('latitude')} className={inputCls} />
            </div>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input type="number" step="any" required placeholder="Longitude" value={form.longitude} onChange={setField('longitude')} className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors">
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <>Create Team</>}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        </form>
      )}

      {/* Create worker form */}
      {showWorker && (
        <form onSubmit={handleCreateWorker} className="px-6 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">New GOV Worker Account</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Users className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input required placeholder="Full name" value={workerForm.name} onChange={setWorkerField('name')} className={inputCls} />
            </div>
            <div className="relative">
              <Phone className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input required type="email" placeholder="Email" value={workerForm.email} onChange={setWorkerField('email')} className={inputCls} />
            </div>
            <div className="relative">
              <Phone className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input required type="password" minLength={6} placeholder="Password (min 6)" value={workerForm.password} onChange={setWorkerField('password')} className={inputCls} />
            </div>
            <select value={workerForm.department} onChange={setWorkerField('department')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none text-slate-700 font-medium">
              <option value="">All departments</option>
              {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors">
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <>Create Worker</>}
            </button>
            <button type="button" onClick={() => setShowWorker(false)} className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        </form>
      )}

      {/* Team list */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="py-10 flex justify-center"><Spinner size="md" text="Loading teams…" /></div>
        ) : teams.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-3xl mb-2">👷</div>
            <p className="font-semibold text-slate-700">No active field teams</p>
            <p className="text-sm text-slate-400 mt-1">Add a team to start dispatching routes</p>
          </div>
        ) : (
          <div className="space-y-3">
            {teams.map((team) => {
              const open = expanded === team._id;
              const members = team.members || [];
              return (
                <div key={team._id} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{team.name}</p>
                        <p className="text-xs text-slate-500 flex items-center gap-2">
                          <span>{team.department}</span>
                          <span className="text-slate-300">·</span>
                          <span>Cap {team.capacity?.maxWorkers ?? '—'}</span>
                          <span className="text-slate-300">·</span>
                          <span>{members.length} worker{members.length !== 1 ? 's' : ''}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setExpanded(open ? null : team._id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        Workers
                      </button>
                      <button
                        onClick={() => handleDelete(team)}
                        disabled={busy}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Deactivate team"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div className="px-4 py-3 border-t border-slate-100 space-y-3">
                      {members.length > 0 ? (
                        <ul className="space-y-1.5">
                          {members.map((m) => (
                            <li key={m._id} className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 rounded-lg">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-700 truncate">{m.name}</p>
                                <p className="text-xs text-slate-400 truncate">{m.email}</p>
                              </div>
                              <button
                                onClick={() => handleRemoveMember(team._id, m._id)}
                                disabled={busy}
                                className="flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-700 shrink-0"
                              >
                                <UserMinus className="w-3.5 h-3.5" /> Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-400 text-center py-1">No workers assigned yet</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={selWorker[team._id] || ''}
                          onChange={(e) => setSelWorker((s) => ({ ...s, [team._id]: e.target.value }))}
                          className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none text-slate-700 font-medium"
                        >
                          <option value="" disabled>Select a worker to assign…</option>
                          {availableFor(team).map((w) => (
                            <option key={w._id} value={w._id}>{w.name} ({w.email})</option>
                          ))}
                        </select>
                        <button
                          onClick={() => { if (selWorker[team._id]) handleAddMember(team._id, selWorker[team._id]); }}
                          disabled={busy || !selWorker[team._id]}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-xl transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Assign
                        </button>
                      </div>
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
