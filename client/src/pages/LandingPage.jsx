import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

// ── Animated Counter Hook ──────────────────────────────────────────────────────
function useCounter(end, duration = 2000, started = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!started) return;
    let startTime = null;
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [end, duration, started]);
  return count;
}

// ── Intersection Observer Hook ─────────────────────────────────────────────────
function useInView(threshold = 0.2) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, icon }) {
  return (
    <div className="civic-stat-card">
      <div className="civic-stat-icon">{icon}</div>
      <div className="civic-stat-number">—</div>
      <div className="civic-stat-label">{label}</div>
    </div>
  );
}

// ── Feature Card ──────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, description, delay }) {
  const [ref, inView] = useInView(0.15);
  return (
    <div
      ref={ref}
      className="civic-feature-card"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(30px)',
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      <div className="civic-feature-icon">{icon}</div>
      <h3 className="civic-feature-title">{title}</h3>
      <p className="civic-feature-desc">{description}</p>
    </div>
  );
}

// ── Step Card ─────────────────────────────────────────────────────────────────
function StepCard({ number, icon, title, description, delay }) {
  const [ref, inView] = useInView(0.15);
  return (
    <div
      ref={ref}
      className="civic-step-card"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      <div className="civic-step-number">{number}</div>
      <div className="civic-step-icon">{icon}</div>
      <h3 className="civic-step-title">{title}</h3>
      <p className="civic-step-desc">{description}</p>
    </div>
  );
}

// ── Testimonial Card ──────────────────────────────────────────────────────────
function TestimonialCard({ name, role, text, avatar, delay }) {
  const [ref, inView] = useInView(0.15);
  return (
    <div
      ref={ref}
      className="civic-testimonial-card"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      <div className="civic-testimonial-quote">❝</div>
      <p className="civic-testimonial-text">{text}</p>
      <div className="civic-testimonial-author">
        <div className="civic-avatar">{avatar}</div>
        <div>
          <div className="civic-author-name">{name}</div>
          <div className="civic-author-role">{role}</div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statsRef, statsInView] = useInView(0.3);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMenuOpen(false);
  };

  const features = [
    {
      icon: '🤖',
      title: 'AI Duplicate Detection',
      description: 'Repeated grievances are automatically identified using AI-based image and text matching, preventing redundant entries and streamlining official processing.',
    },
    {
      icon: '🏷️',
      title: 'Smart Categorization',
      description: 'Each submission is automatically routed to the appropriate government department based on complaint content — no manual intervention required.',
    },
    {
      icon: '📡',
      title: 'Real-Time Status Tracking',
      description: 'Citizens can monitor the progress of their grievance at every stage through a transparent, publicly accessible tracking system.',
    },
    {
      icon: '📍',
      title: 'Geo-tagged Complaints',
      description: 'GPS coordinates are attached to each report, enabling field officials to locate and respond to issues with greater accuracy.',
    },
    {
      icon: '📊',
      title: 'Authority Dashboard',
      description: 'Designated government officers access a dedicated dashboard to manage, prioritize, and resolve incoming grievances efficiently.',
    },
    {
      icon: '🔔',
      title: 'Citizen Notifications',
      description: 'Registered citizens receive timely status updates whenever their complaint is reviewed, escalated, or resolved by the concerned authority.',
    },
  ];

  const steps = [
    { number: '01', icon: '📸', title: 'Submit Grievance', description: 'Upload a photo and description of the civic issue. Submissions are accepted from any device, anywhere.' },
    { number: '02', icon: '🤖', title: 'AI Processing ', description: 'The AI system generates Description based on the image submission and checks for duplicate reports and prioritizes the submitted issues to action.' },
    { number: '03', icon: '🏛️', title: 'Official Review', description: 'The designated authority verifies and acknowledges the reported issue, initiating the resolution process.' },
    { number: '04', icon: '✅', title: 'Resolution & Closure', description: 'Citizens track official progress in real time until the issue is resolved and formally closed.' },
  ];

  const testimonials = [
    {
      name: '—',
      role: 'Citizen, Bangalore',
      text: 'Submitting complaints has never been easier. I reported a broken streetlight and it was fixed within 3 days. Incredible!',
      avatar: '👩',
    },
    {
      name: '—',
      role: 'Municipal Officer, Delhi',
      text: 'The AI duplicate detection saves us hours of manual work every day. Our team can focus on actually solving problems now.',
      avatar: '👨‍💼',
    },
    {
      name: '—',
      role: 'Ward Councilor, Mumbai',
      text: 'The analytics dashboard gives us a clear picture of city-wide issues. CivicAI has transformed how we serve our community.',
      avatar: '👩‍💼',
    },
  ];

  return (
    <div className="landing-root">
      {/* ── Navbar ──────────────────────────────────────────────────────────── */}
      <nav className={`landing-nav ${scrolled ? 'landing-nav--scrolled' : ''}`}>
        <div className="landing-nav__inner">
          <a href="#hero" className="landing-nav__logo" onClick={(e) => { e.preventDefault(); scrollTo('hero'); }}>
            <span className="landing-nav__logo-icon">🏙️</span>
            <span className="landing-nav__logo-text">CivicAI</span>
          </a>

          {/* Desktop links */}
          <div className="landing-nav__links">
            {['features', 'how-it-works', 'stats', 'about'].map((id) => (
              <button key={id} className="landing-nav__link" onClick={() => scrollTo(id)}>
                {id === 'how-it-works' ? 'How It Works' : id.charAt(0).toUpperCase() + id.slice(1)}
              </button>
            ))}
          </div>

          <div className="landing-nav__actions">
            <Link to="/report" className="landing-nav__report-btn">🚀 Report a Complaint</Link>
            <Link to="/login/citizen" className="landing-nav__login-btn">Login</Link>
          </div>

          {/* Hamburger */}
          <button className="landing-nav__hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
            <span className={`hamburger-line ${menuOpen ? 'open-1' : ''}`} />
            <span className={`hamburger-line ${menuOpen ? 'open-2' : ''}`} />
            <span className={`hamburger-line ${menuOpen ? 'open-3' : ''}`} />
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="landing-nav__mobile">
            {['features', 'how-it-works', 'stats', 'about'].map((id) => (
              <button key={id} className="landing-nav__mobile-link" onClick={() => scrollTo(id)}>
                {id === 'how-it-works' ? 'How It Works' : id.charAt(0).toUpperCase() + id.slice(1)}
              </button>
            ))}
            <Link to="/report" className="landing-nav__mobile-cta">🚀 Report a Complaint</Link>
            <Link to="/login/citizen" className="landing-nav__mobile-cta">Login</Link>
          </div>
        )}
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section id="hero" className="landing-hero">
        <div className="landing-hero__bg-shapes">
          <div className="hero-shape hero-shape--1" />
          <div className="hero-shape hero-shape--2" />
          <div className="hero-shape hero-shape--3" />
        </div>
        <div className="landing-hero__content">
          <div className="landing-hero__text">
            <div className="landing-hero__badge">
              <span>🏛️</span> Government Grievance Redressal Portal
            </div>
            <h1 className="landing-hero__headline">
              Your Grievance. <span className="landing-hero__highlight">Heard.</span>
              <br />Resolved <span className="landing-hero__highlight">Transparently</span>
            </h1>
            <p className="landing-hero__subheadline">
              An AI-assisted government portal for citizens to report civic issues, track official responses, and hold authorities accountable — transparently and efficiently.
            </p>
            <div className="landing-hero__actions">
              <Link to="/login/citizen" className="landing-btn landing-btn--secondary">
                <span>🔑</span> Register
              </Link>
            </div>
            <div className="landing-hero__trust">
              <div className="landing-hero__trust-item">
                <span className="landing-hero__trust-icon">🆓</span>
                <span>Free for All Citizens</span>
              </div>
              <div className="landing-hero__trust-item">
                <span className="landing-hero__trust-icon">🔒</span>
                <span>Secure & Confidential</span>
              </div>
              <div className="landing-hero__trust-item">
                <span className="landing-hero__trust-icon">🏛️</span>
                <span>Official Portal</span>
              </div>
            </div>
          </div>
          <div className="landing-hero__visual">
            <img
              src="/images/hero-illustration.png"
              alt="Citizens reporting issues processed by AI and reviewed by authorities"
              className="landing-hero__img"
            />
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section id="features" className="landing-section">
        <div className="landing-section__inner">
          <div className="landing-section__header">
            <div className="landing-section__label">Capabilities</div>
            <h2 className="landing-section__title">Built for Transparent, Accountable Governance</h2>
            <p className="landing-section__subtitle">
              From AI-assisted processing to real-time tracking — this portal equips citizens and government officials with the tools needed for efficient grievance redressal.
            </p>
          </div>
          <div className="civic-features-grid">
            {features.map((f, i) => (
              <FeatureCard key={f.title} {...f} delay={i * 80} />
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="landing-section landing-section--alt">
        <div className="landing-section__inner">
          <div className="landing-section__header">
            <div className="landing-section__label">Process</div>
            <h2 className="landing-section__title">How the Portal Works</h2>
            <p className="landing-section__subtitle">
              A structured, AI-assisted process — from grievance submission to official resolution — with full transparency at every stage.
            </p>
          </div>
          <div className="civic-steps-container">
            <div className="civic-steps-line" />
            <div className="civic-steps-grid">
              {steps.map((s, i) => (
                <StepCard key={s.number} {...s} delay={i * 100} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Statistics ──────────────────────────────────────────────────────── */}
      <section id="stats" className="landing-section landing-section--dark" ref={statsRef}>
        <div className="landing-section__inner">
          <div className="landing-section__header landing-section__header--light">
            <div className="landing-section__label landing-section__label--light">Portal Scope</div>
            <h2 className="landing-section__title landing-section__title--light">Designed for Scale Across India</h2>
            <p className="landing-section__subtitle landing-section__subtitle--light">
              This portal is being developed to serve citizens across municipalities, districts, and urban local bodies nationwide.
            </p>
          </div>
          <div className="civic-stats-grid">
            <StatCard label="Grievances Addressed" icon="✅" />
            <StatCard label="Authorities Onboarded" icon="🏛️" />
            <StatCard label="Cities in Scope" icon="🌆" />
            <StatCard label="Citizen Satisfaction" icon="⭐" />
          </div>
        </div>
      </section>

      {/* ── Testimonials ────────────────────────────────────────────────────── */}
      <section id="about" className="landing-section">
        <div className="landing-section__inner">
          <div className="landing-section__header">
            <div className="landing-section__label">About</div>
            <h2 className="landing-section__title">Why This Portal Exists</h2>
            <p className="landing-section__subtitle">
              Hear from citizens and officials on why a transparent, AI-powered grievance system is essential for modern governance.
            </p>
          </div>
          <div className="civic-testimonials-grid">
            {testimonials.map((t, i) => (
              <TestimonialCard key={t.name} {...t} delay={i * 100} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Strip ───────────────────────────────────────────────────────── */}
      <section className="landing-cta">
        <div className="landing-cta__inner">
          <div className="landing-cta__shapes">
            <div className="cta-shape cta-shape--1" />
            <div className="cta-shape cta-shape--2" />
          </div>
          <div className="landing-cta__content">
            <h2 className="landing-cta__title">Be Part of a Smarter Governance System</h2>
            <p className="landing-cta__subtitle">Register your grievance or log in as an authority to begin the redressal process.</p>
            <div className="landing-cta__actions">
              <Link to="/report" className="landing-btn landing-btn--cta-primary">🚀 Submit a Grievance</Link>
              <Link to="/login/authority" className="landing-btn landing-btn--cta-secondary">🏛️ Authority Login</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-footer__inner">
          <div className="landing-footer__brand">
            <div className="landing-footer__logo">
              <span>🏙️</span> CivicAI
            </div>
            <p className="landing-footer__tagline">
              Government Grievance Redressal Portal — Bridging citizens and public authorities through transparent, AI-assisted governance.
            </p>
            
          </div>

          <div className="landing-footer__links">
            <div className="landing-footer__col">
              <h4 className="landing-footer__col-title">Quick Links</h4>
              <button className="landing-footer__link" onClick={() => scrollTo('features')}>Features</button>
              <button className="landing-footer__link" onClick={() => scrollTo('how-it-works')}>How It Works</button>
              <button className="landing-footer__link" onClick={() => scrollTo('stats')}>Impact</button>
              <button className="landing-footer__link" onClick={() => scrollTo('about')}>About</button>
            </div>
            <div className="landing-footer__col">
              <h4 className="landing-footer__col-title">Platform</h4>
              <Link to="/report" className="landing-footer__link">Report Issue</Link>
              <Link to="/map" className="landing-footer__link">Map View</Link>
              <Link to="/login/citizen" className="landing-footer__link">Citizen Login</Link>
              <Link to="/login/authority" className="landing-footer__link">Authority Login</Link>
            </div>
            
          </div>
        </div>
        <div className="landing-footer__bottom">
          
          <span>Built for smarter cities</span>
        </div>
      </footer>
    </div>
  );
}
