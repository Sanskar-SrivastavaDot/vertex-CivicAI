import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, MapPin, Mail, Phone, Calendar, Edit2, LogOut, Settings, Key,
  Bell, Trash2, Eye, ShieldCheck, CheckCircle2, Clock, AlertCircle,
  Save, X, Camera, Loader2, RefreshCw
} from 'lucide-react';
import { getStoredUser, getToken, clearAuth, formatCitizenId, avatarUrl, isAuthenticated } from '../utils/auth';
import { useAuth } from '../context/AuthContext';
import { BACKEND_URL } from '../utils/api';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { updateUser, logout, user: ctxUser } = useAuth();

  // ─── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/login/citizen', { replace: true });
    }
  }, [navigate]);

  // ─── Hydrate from localStorage + optionally refresh from API ───────────────
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [userData, setUserData]   = useState(null);
  const [formData, setFormData]   = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [pfpPreview, setPfpPreview] = useState(null);
  const pfpInputRef = React.useRef(null);

  // ─── Modal & Settings State ──────────────────────────────────────────────────
  const [activeModal, setActiveModal] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [modalError, setModalError] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // ─── My Grievances (real data from MongoDB) ──────────────────────────────────
  const [myIssues, setMyIssues]   = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(false);

  const fetchMyIssues = async () => {
    const token = getToken();
    if (!token) return;
    try {
      setIssuesLoading(true);
      const res = await fetch(`${BACKEND_URL}/api/issues/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMyIssues(data.issues || []);
      }
    } catch {
      // silent fail — show empty
    } finally {
      setIssuesLoading(false);
    }
  };

  // ─── Live stats computed from real issues ──────────────────────────────────
  const summary = useMemo(() => ({
    total:      myIssues.length,
    resolved:   myIssues.filter(i => i.status === 'Resolved').length,
    pending:    myIssues.filter(i => i.status === 'Pending').length,
    inProgress: myIssues.filter(i => i.status === 'In Progress').length,
  }), [myIssues]);

  // ─── PFP change handler ────────────────────────────────────────────────────
  const handlePfpChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setSaveError('Image must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = ev.target.result;
      setPfpPreview(b64);
      // Update context immediately → Navbar re-renders
      updateUser({ profilePicture: b64 });
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      navigate('/login/citizen', { replace: true });
      return;
    }

    // Build a normalised profile from whatever the server returned
    const profile = buildProfile(stored);
    setUserData(profile);
    setFormData(profile);
    if (profile.notifications !== undefined) setNotificationsEnabled(profile.notifications);

    // Fetch real issues immediately
    fetchMyIssues();

    // Try to refresh profile from backend (gracefully degrade if offline)
    const token = getToken();
    if (token) {
      fetch(`${BACKEND_URL}/api/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(fresh => {
          if (fresh) {
            const refreshed = buildProfile(fresh);
            setUserData(refreshed);
            setFormData(refreshed);
            // Restore saved profile picture from MongoDB into context + preview
            if (fresh.profilePicture) {
              setPfpPreview(fresh.profilePicture);
              updateUser({ ...fresh, profilePicture: fresh.profilePicture });
            } else {
              updateUser(fresh);
            }
            localStorage.setItem('user', JSON.stringify(fresh));
          }
        })
        .catch(() => { /* offline – use cached data */ })
        .finally(() => setLoadingProfile(false));
    } else {
      setLoadingProfile(false);
    }
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handle Edit / Save ────────────────────────────────────────────────────
  const handleEditToggle = () => {
    if (isEditing) setFormData(userData); // cancel → reset
    setIsEditing(v => !v);
    setSaveError('');
  };

  const handleSave = async () => {
    setSaveError('');
    const token = getToken();

    // Optimistic local update — also syncs to Navbar via context
    const pfpToSave = pfpPreview || getStoredUser()?.profilePicture;
    updateUser({
      name:           formData.fullName,
      email:          formData.email,
      profilePicture: pfpToSave,
      profileDetails: { phone: formData.phone, address: formData.address, notifications: notificationsEnabled },
    });
    setUserData(formData);
    setIsEditing(false);

    // Optionally persist to backend (non-blocking)
    if (token) {
      try {
        await fetch(`${BACKEND_URL}/api/auth/profile`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: formData.fullName,
            email: formData.email,
            profilePicture: pfpPreview,
            profileDetails: { phone: formData.phone, address: formData.address, notifications: notificationsEnabled },
          }),
        });
      } catch {
        // Silent fail — local state already updated
      }
    }
  };

  // ─── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  // ─── Account Settings Handlers ─────────────────────────────────────────────
  const handleToggleNotifications = async () => {
    const newVal = !notificationsEnabled;
    setNotificationsEnabled(newVal);
    const newDetails = { phone: formData.phone, address: formData.address, notifications: newVal };
    updateUser({ profileDetails: newDetails });
    const token = getToken();
    if (token) {
      fetch(`${BACKEND_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profileDetails: newDetails }),
      }).catch(() => {});
    }
  };

  const handlePasswordChange = async () => {
    setModalError('');
    if (!passwordForm.current || !passwordForm.new || !passwordForm.confirm) {
      return setModalError('All fields are required.');
    }
    if (passwordForm.new !== passwordForm.confirm) {
      return setModalError('New passwords do not match.');
    }
    if (passwordForm.new.length < 6) {
      return setModalError('Password must be at least 6 characters.');
    }
    const token = getToken();
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: passwordForm.current, newPassword: passwordForm.new }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password.');
      setActiveModal(null);
    } catch (err) {
      setModalError(err.message);
    }
  };

  const handleDeleteAccount = async () => {
    setModalError('');
    const token = getToken();
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete account.');
      handleLogout();
    } catch (err) {
      setModalError(err.message);
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const getStatusBadge = (status) => {
    switch (status) {
      case 'Resolved':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"><CheckCircle2 className="w-3 h-3" /> Resolved</span>;
      case 'In Progress':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-600/20"><Clock className="w-3 h-3" /> In Progress</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-600/20"><AlertCircle className="w-3 h-3" /> Pending</span>;
    }
  };

  // ─── Loading spinner ───────────────────────────────────────────────────────
  if (loadingProfile || !userData) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-sm font-medium">Loading your profile…</span>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col md:flex-row gap-6">

        {/* ── Left Column ─────────────────────────────────────────────────── */}
        <div className="space-y-6 w-full md:w-1/3">

          {/* Profile Header Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="h-32 bg-gradient-to-r from-blue-600 to-indigo-700" />
            <div className="px-6 pb-6 relative">
              <div className="flex justify-between items-end -mt-12 mb-4">
                {/* Avatar + PFP upload */}
                <div className="relative group">
                  <div className="w-24 h-24 rounded-full border-4 border-white bg-slate-100 overflow-hidden shadow">
                    <img
                      src={pfpPreview || ctxUser?.profilePicture || userData.avatarUrl}
                      alt={userData.fullName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {/* Camera overlay — always visible on hover, always clickable in edit mode */}
                  <button
                    type="button"
                    title="Change profile picture"
                    onClick={() => pfpInputRef.current?.click()}
                    className={`absolute inset-0 rounded-full flex items-center justify-center transition-all ${
                      isEditing
                        ? 'bg-black/40 opacity-100 cursor-pointer'
                        : 'bg-black/0 opacity-0 group-hover:bg-black/30 group-hover:opacity-100 cursor-pointer'
                    }`}
                  >
                    <Camera className="w-6 h-6 text-white drop-shadow" />
                  </button>
                  {/* Hidden file input */}
                  <input
                    ref={pfpInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handlePfpChange}
                  />
                  {/* "Changed" indicator */}
                  {pfpPreview && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 border-2 border-white rounded-full flex items-center justify-center text-[10px] text-white font-bold">✓</span>
                  )}
                </div>

                {/* Edit / Save / Cancel */}
                <div className="flex gap-2">
                  <button
                    onClick={isEditing ? handleSave : handleEditToggle}
                    className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors ${
                      isEditing
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {isEditing ? <><Save className="w-4 h-4" /> Save</> : <><Edit2 className="w-4 h-4" /> Edit</>}
                  </button>
                  {isEditing && (
                    <button
                      onClick={handleEditToggle}
                      className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors bg-slate-50 border border-slate-200"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              {saveError && (
                <p className="mb-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{saveError}</p>
              )}

              <div className="space-y-1">
                <h2 className="text-xl font-bold text-slate-900">{userData.fullName}</h2>
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                  <ShieldCheck className="w-4 h-4 text-blue-500" />
                  <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-xs border border-slate-200">
                    {userData.citizenId}
                  </span>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <Field icon={<Mail className="w-4 h-4 text-slate-400" />} value={formData.email} editing={isEditing} type="email"
                  onChange={e => setFormData({ ...formData, email: e.target.value })} />
                <Field icon={<Phone className="w-4 h-4 text-slate-400" />} value={formData.phone} editing={isEditing} type="tel"
                  onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                <Field icon={<MapPin className="w-4 h-4 text-slate-400" />} value={formData.address} editing={isEditing} type="text"
                  onChange={e => setFormData({ ...formData, address: e.target.value })} />
              </div>

              <div className="mt-6 pt-6 border-t border-slate-100">
                <button
                  onClick={handleLogout}
                  className="w-full py-2.5 flex justify-center items-center gap-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </div>
          </div>

          {/* Settings Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" /> Account Settings
            </h3>
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => { setActiveModal('password'); setPasswordForm({ current: '', new: '', confirm: '' }); setModalError(''); }}
                  className="w-full flex items-center p-3 rounded-xl hover:bg-slate-50 transition-colors text-sm text-slate-700 font-medium gap-3"
                >
                  <Key className="w-4 h-4 text-slate-400" /> Change Password
                </button>
              </li>
              <li>
                <button
                  onClick={handleToggleNotifications}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors text-sm text-slate-700 font-medium"
                >
                  <div className="flex items-center gap-3"><Bell className="w-4 h-4 text-slate-400" /> Notifications</div>
                  <div className={`w-9 h-5 rounded-full relative transition-colors ${notificationsEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${notificationsEnabled ? 'right-0.5' : 'left-0.5'}`} />
                  </div>
                </button>
              </li>
              <li className="pt-2">
                <button
                  onClick={() => { setActiveModal('delete'); setDeleteConfirmation(''); setModalError(''); }}
                  className="w-full flex items-center p-3 rounded-xl hover:bg-red-50 text-red-600 transition-colors text-sm font-medium gap-3 group"
                >
                  <Trash2 className="w-4 h-4 text-red-400 group-hover:text-red-600 transition-colors" /> Delete Account
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* ── Right Column ─────────────────────────────────────────────────── */}
        <div className="flex-1 space-y-6">

          {/* Stats Row — live from MongoDB */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Filed"  value={summary.total}      className="border-slate-200"  textClass="text-slate-900" />
            <StatCard label="Resolved"     value={summary.resolved}   className="border-emerald-100 bg-emerald-50/50" textClass="text-emerald-700" labelClass="text-emerald-700" />
            <StatCard label="Pending"      value={summary.pending}    className="border-amber-100 bg-amber-50/50"   textClass="text-amber-700"  labelClass="text-amber-700" />
            <StatCard label="In Progress"  value={summary.inProgress} className="border-blue-100 bg-blue-50/50"    textClass="text-blue-700"   labelClass="text-blue-700" />
          </div>

          {/* Personal Information */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
              <User className="w-5 h-5 text-blue-600" /> Personal Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">

              <FormField label="Full Name">
                {isEditing
                  ? <input type="text" value={formData.fullName} onChange={e => setFormData({ ...formData, fullName: e.target.value })} className={inputCls} />
                  : <ReadValue>{userData.fullName}</ReadValue>}
              </FormField>

              <FormField label="Citizen ID">
                <ReadValue muted>{userData.citizenId}</ReadValue>
              </FormField>

              <FormField label="Email Address">
                {isEditing
                  ? <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className={inputCls} />
                  : <ReadValue>{userData.email}</ReadValue>}
              </FormField>

              <FormField label="Phone Number">
                {isEditing
                  ? <input type="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className={inputCls} />
                  : <ReadValue>{userData.phone || '—'}</ReadValue>}
              </FormField>

              <FormField label="Registered Address" full>
                {isEditing
                  ? <input type="text" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} className={inputCls} />
                  : <ReadValue>{userData.address || '—'}</ReadValue>}
              </FormField>

              <div className="sm:col-span-2 mt-2 border-t border-slate-100 pt-5">
                <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                  <Calendar className="w-4 h-4 text-blue-500" />
                  Member since {formatDate(userData.registrationDate)}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Grievances — real data */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900">
                My Grievances
                {myIssues.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-slate-400">({myIssues.length})</span>
                )}
              </h3>
              <button
                onClick={fetchMyIssues}
                disabled={issuesLoading}
                className="flex items-center gap-1.5 text-sm text-blue-600 font-medium hover:text-blue-700 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${issuesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto">
              {issuesLoading ? (
                <div className="py-16 flex justify-center">
                  <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
                </div>
              ) : myIssues.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-medium">No grievances filed yet.</p>
                  <p className="text-xs mt-1">Report a civic issue to get started.</p>
                </div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3.5 font-semibold uppercase tracking-wider">Image</th>
                      <th className="px-4 py-3.5 font-semibold uppercase tracking-wider">Issue</th>
                      <th className="px-4 py-3.5 font-semibold uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3.5 font-semibold uppercase tracking-wider">Priority</th>
                      <th className="px-4 py-3.5 font-semibold uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {myIssues.map(issue => (
                      <tr key={issue._id} className="hover:bg-slate-50/80 transition-colors">
                        {/* Thumbnail */}
                        <td className="px-4 py-3">
                          <div className="w-14 h-10 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                            <img
                              src={`${BACKEND_URL}${issue.imageUrl}`}
                              alt="issue"
                              className="w-full h-full object-cover"
                              onError={e => { e.target.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='56' height='40'><rect fill='%23f1f5f9' width='56' height='40'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-size='16'>🏙️</text></svg>"; }}
                            />
                          </div>
                        </td>
                        {/* Title + category */}
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 text-sm leading-snug max-w-[200px]">
                            {issue.title || issue.description?.slice(0, 50) + '…'}
                          </div>
                          <div className="text-slate-400 text-xs mt-0.5">{issue.category}</div>
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">{getStatusBadge(issue.status)}</td>
                        {/* Priority */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            issue.priority === 'High'   ? 'bg-red-50 text-red-700'    :
                            issue.priority === 'Medium' ? 'bg-amber-50 text-amber-700' :
                                                          'bg-green-50 text-green-700'
                          }`}>
                            {issue.priority === 'High' ? '🔴' : issue.priority === 'Medium' ? '🟠' : '🟢'} {issue.priority}
                          </span>
                        </td>
                        {/* Date */}
                        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                          {new Date(issue.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short', year: 'numeric'
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ─── Modals ───────────────────────────────────────────────────────── */}
      {activeModal === 'password' && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm absolute shadow-xl">
            <h3 className="text-lg font-bold mb-4">Change Password</h3>
            {modalError && <p className="mb-3 text-xs text-red-600 bg-red-50 p-2 rounded">{modalError}</p>}
            <div className="space-y-3">
              <input type="password" placeholder="Current Password" value={passwordForm.current} onChange={e => setPasswordForm({ ...passwordForm, current: e.target.value })} className={inputCls} />
              <input type="password" placeholder="New Password" value={passwordForm.new} onChange={e => setPasswordForm({ ...passwordForm, new: e.target.value })} className={inputCls} />
              <input type="password" placeholder="Confirm New Password" value={passwordForm.confirm} onChange={e => setPasswordForm({ ...passwordForm, confirm: e.target.value })} className={inputCls} />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setActiveModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancel</button>
              <button onClick={handlePasswordChange} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'delete' && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2 text-red-600 flex items-center gap-2"><AlertCircle className="w-5 h-5"/> Delete Account</h3>
            <p className="text-sm text-slate-600 mb-4">This action cannot be undone. All your grievances and personal data will be permanently deleted.</p>
            {modalError && <p className="mb-3 text-xs text-red-600 bg-red-50 p-2 rounded">{modalError}</p>}
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Type DELETE to confirm</label>
            <input type="text" value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} className={inputCls} placeholder="DELETE" />
            
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setActiveModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancel</button>
              <button onClick={handleDeleteAccount} disabled={deleteConfirmation !== 'DELETE'} className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 font-medium transition-colors">Delete Account</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Field({ icon, value, editing, type, onChange }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-700">
      {icon}
      {editing
        ? <input type={type} value={value} onChange={onChange}
            className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all shadow-sm" />
        : <span className="truncate">{value || '—'}</span>}
    </div>
  );
}

function StatCard({ label, value, className = '', textClass = 'text-slate-900', labelClass = 'text-slate-500' }) {
  return (
    <div className={`bg-white p-5 rounded-2xl border shadow-sm hover:shadow-md transition-shadow ${className}`}>
      <div className={`text-sm font-medium ${labelClass}`}>{label}</div>
      <div className={`mt-2 text-3xl font-bold ${textClass}`}>{value}</div>
    </div>
  );
}

function FormField({ label, children, full }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ReadValue({ children, muted }) {
  return (
    <div className={`text-sm font-medium px-3.5 py-2.5 rounded-lg border ${muted ? 'text-slate-500 bg-slate-50 border-slate-100 cursor-not-allowed' : 'text-slate-900 bg-slate-50 border-transparent'}`}>
      {children}
    </div>
  );
}

// ─── Shared input class ──────────────────────────────────────────────────────
const inputCls = 'w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all shadow-sm';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a normalised profile from a raw API/localStorage user object. */
function buildProfile(user) {
  return {
    fullName:         user.name || 'Unknown',
    email:            user.email || '',
    phone:            user.profileDetails?.phone || '',
    address:          user.profileDetails?.address || '',
    notifications:    user.profileDetails?.notifications !== false,
    registrationDate: user.createdAt || new Date().toISOString(),
    citizenId:        formatCitizenId(user.id || user._id || '', user.citizenId || ''),
    avatarUrl:        avatarUrl(user.name || 'User'),
  };
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '—';
  }
}
