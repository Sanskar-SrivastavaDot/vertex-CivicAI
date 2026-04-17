import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../utils/api';

export default function RegisterPage() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const validate = () => {
    if (!form.fullName || !form.email || !form.phone || !form.address || !form.password || !form.confirmPassword) {
      return 'Please fill in all required fields.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      return 'Please enter a valid email address.';
    }
    if (!/^\d{10}$/.test(form.phone.replace(/\D/g, ''))) {
      return 'Please enter a valid 10-digit phone number.';
    }
    if (form.password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (form.password !== form.confirmPassword) {
      return 'Passwords do not match.';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.fullName,
          email: form.email,
          password: form.password,
          role: 'Citizen',
          profileDetails: {
            phone: form.phone,
            address: form.address
          }
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Registration failed');
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      // Redirect directly to profile — token is already stored
      navigate('/profile', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // (success screen removed — navigate() sends user straight to /profile)

  const passwordStrength = () => {
    if (!form.password) return null;
    const len = form.password.length;
    if (len < 6) return { label: 'Weak', color: '#ef4444', width: '25%' };
    if (len < 10) return { label: 'Fair', color: '#f59e0b', width: '50%' };
    if (len < 14) return { label: 'Good', color: '#3b82f6', width: '75%' };
    return { label: 'Strong', color: '#10b981', width: '100%' };
  };
  const strength = passwordStrength();

  return (
    <div className="auth-page auth-page--register">
      {/* Left branding panel */}
      <div className="auth-panel auth-panel--left auth-panel--register">
        <div className="auth-panel__overlay" />
        <div className="auth-panel__content">
          <Link to="/" className="auth-panel__logo">
            <span>🏙️</span> CivicAI
          </Link>
          <div className="auth-register-hero">
            <div className="register-hero-icon">🌆</div>
            <h2>Join the Movement</h2>
            <p>Create your free citizen account and help build a smarter, more responsive city.</p>
          </div>
          <div className="auth-register-benefits">
            {[
              { icon: '📸', text: 'Report issues with photos' },
              { icon: '📡', text: 'Real-time GPS tracking' },
              { icon: '🔔', text: 'Instant status notifications' },
              { icon: '📊', text: 'Track resolution progress' },
              { icon: '🤖', text: 'AI-powered processing' },
            ].map((b) => (
              <div key={b.text} className="auth-register-benefit">
                <span>{b.icon}</span>
                <span>{b.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Registration form */}
      <div className="auth-panel auth-panel--right auth-panel--register-form">
        <div className="auth-form-container auth-form-container--wide">
          <Link to="/" className="auth-mobile-logo">
            <span>🏙️</span> CivicAI
          </Link>

          <div className="auth-form-header">
            <div className="auth-form-icon auth-form-icon--register">✍️</div>
            <h1 className="auth-form-title">Create Citizen Account</h1>
            <p className="auth-form-subtitle">Fill in your details to get started for free</p>
          </div>

          {error && (
            <div className="auth-error">
              <span>⚠️</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form auth-form--two-col" id="register-form">
            <div className="auth-field auth-field--full">
              <label htmlFor="reg-fullname" className="auth-label">Full Name <span className="auth-required">*</span></label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">👤</span>
                <input
                  id="reg-fullname"
                  type="text"
                  name="fullName"
                  autoComplete="name"
                  placeholder="Your full name"
                  value={form.fullName}
                  onChange={handleChange}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="reg-email" className="auth-label">Email Address <span className="auth-required">*</span></label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">📧</span>
                <input
                  id="reg-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={handleChange}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="reg-phone" className="auth-label">Phone Number <span className="auth-required">*</span></label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">📱</span>
                <input
                  id="reg-phone"
                  type="tel"
                  name="phone"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={form.phone}
                  onChange={handleChange}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="auth-field auth-field--full">
              <label htmlFor="reg-address" className="auth-label">Address <span className="auth-required">*</span></label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">🏠</span>
                <input
                  id="reg-address"
                  type="text"
                  name="address"
                  autoComplete="street-address"
                  placeholder="Your residential address"
                  value={form.address}
                  onChange={handleChange}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="reg-password" className="auth-label">Password <span className="auth-required">*</span></label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">🔒</span>
                <input
                  id="reg-password"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  value={form.password}
                  onChange={handleChange}
                  className="auth-input"
                />
              </div>
              {strength && (
                <div className="auth-strength">
                  <div className="auth-strength__bar">
                    <div className="auth-strength__fill" style={{ width: strength.width, background: strength.color }} />
                  </div>
                  <span className="auth-strength__label" style={{ color: strength.color }}>{strength.label}</span>
                </div>
              )}
            </div>

            <div className="auth-field">
              <label htmlFor="reg-confirm-password" className="auth-label">Confirm Password <span className="auth-required">*</span></label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">🔑</span>
                <input
                  id="reg-confirm-password"
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  className={`auth-input ${form.confirmPassword && form.password !== form.confirmPassword ? 'auth-input--error' : ''}`}
                />
              </div>
              {form.confirmPassword && form.password !== form.confirmPassword && (
                <p className="auth-field-error">Passwords do not match</p>
              )}
            </div>

            <div className="auth-field auth-field--full">
              <button
                type="submit"
                id="register-btn"
                disabled={loading}
                className="auth-submit-btn auth-submit-btn--citizen"
              >
                {loading ? (
                  <span className="auth-spinner">
                    <span className="auth-spinner__dot" />
                    <span className="auth-spinner__dot" />
                    <span className="auth-spinner__dot" />
                  </span>
                ) : (
                  <>✅ Create Account</>
                )}
              </button>
            </div>
          </form>

          <div className="auth-switch-link">
            Already have an account?{' '}
            <Link to="/login/citizen" className="auth-switch-anchor">Sign In →</Link>
          </div>

          <div className="auth-back-link">
            <Link to="/" className="auth-back">← Back to Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
