import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BACKEND_URL } from '../utils/api';

export default function AuthorityLoginPage() {
  const [form, setForm] = useState({ authorityId: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const navigate = useNavigate();
  const { updateUser } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.authorityId || !form.password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.authorityId, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Verify this account has GOV role
      if (data.user?.role !== 'GOV') {
        throw new Error('Access denied. This portal is for government officials only.');
      }

      // Store token and user data
      localStorage.setItem('token', data.token);
      updateUser(data.user);

      // Redirect to authority admin dashboard
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page auth-page--authority">
      {/* Right panel – illustration for authority */}
      <div className="auth-panel auth-panel--left auth-panel--authority">
        <div className="auth-panel__overlay" />
        <div className="auth-panel__content">
          <Link to="/" className="auth-panel__logo">
            <span>🏙️</span> CivicAI
          </Link>
          <img
            src="/images/authority-login.png"
            alt="Authority reviewing complaint dashboard"
            className="auth-panel__illustration"
          />
          <div className="auth-panel__tagline">
            <h2>Manage. Prioritize. Resolve.</h2>
            <p>Access the authority command center to drive faster resolutions and better governance.</p>
          </div>
          <div className="auth-security-notice">
            <span className="auth-security-icon">🛡️</span>
            <div>
              <div className="auth-security-title">Authorized Personnel Only</div>
              <div className="auth-security-desc">This portal is restricted to verified government officials. Unauthorized access is prohibited.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="auth-panel auth-panel--right">
        <div className="auth-form-container">
          <Link to="/" className="auth-mobile-logo">
            <span>🏙️</span> CivicAI
          </Link>

          <div className="auth-form-header">
            <div className="auth-form-icon auth-form-icon--authority">🏛️</div>
            <h1 className="auth-form-title">Authority Login</h1>
            <p className="auth-form-subtitle">Access the government complaint management portal</p>
          </div>

          <div className="auth-authority-notice">
            <span>🔐</span>
            <span>This is a restricted portal for authorized government personnel only.</span>
          </div>

          {error && (
            <div className="auth-error">
              <span>⚠️</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form" id="authority-login-form">
            <div className="auth-field">
              <label htmlFor="authority-id" className="auth-label">Authority ID</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">🪪</span>
                <input
                  id="authority-id"
                  type="text"
                  name="authorityId"
                  autoComplete="username"
                  placeholder="Enter your Authority ID"
                  value={form.authorityId}
                  onChange={handleChange}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="authority-password" className="auth-label">Password</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">🔒</span>
                <input
                  id="authority-password"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your secure password"
                  value={form.password}
                  onChange={handleChange}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="auth-form-row auth-form-row--end">
              <Link to="/forgot-password/authority" className="auth-forgot">Forgot Password?</Link>
            </div>

            <button
              type="submit"
              id="authority-login-btn"
              disabled={loading}
              className="auth-submit-btn auth-submit-btn--authority"
            >
              {loading ? (
                <span className="auth-spinner">
                  <span className="auth-spinner__dot" />
                  <span className="auth-spinner__dot" />
                  <span className="auth-spinner__dot" />
                </span>
              ) : (
                <>🔐 Secure Login</>
              )}
            </button>
          </form>

          <div className="auth-switch-link">
            Are you a citizen?{' '}
            <Link to="/login/citizen" className="auth-switch-anchor">
              Citizen Login →
            </Link>
          </div>

          <div className="auth-back-link">
            <Link to="/" className="auth-back">← Back to Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
