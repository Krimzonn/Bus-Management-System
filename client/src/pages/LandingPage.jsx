import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import "../landing.css";

// Drop a real photograph at client/public/images/hero-coach.jpg.
// If it is missing or fails to load, an SVG illustration is shown instead.
const HERO_IMAGE = "/images/hero-coach.jpg";
const HERO_ALT = "A modern touring coach on the road";

const NAV = [
  { id: "services", label: "Services" },
  { id: "platform", label: "Platform" },
];

const ASSURANCES = [
  "Role-based access",
  "Complete audit trail",
  "Desktop, tablet and mobile",
];

const SERVICES = [
  {
    icon: "bus",
    title: "Fleet and maintenance",
    text: "Keep every vehicle’s status, service history, fuel records and upcoming maintenance in a single record.",
  },
  {
    icon: "route",
    title: "Routes",
    text: "Maintain routes and their availability, so a blocked route never reaches a schedule.",
  },
  {
    icon: "calendar",
    title: "Scheduling and assignments",
    text: "Assign buses, drivers and routes with eligibility checks and clash prevention built in.",
  },
  {
    icon: "users",
    title: "Drivers and licences",
    text: "Track driver availability and licence validity, with early warning before a licence expires.",
  },
  {
    icon: "file",
    title: "Recruitment",
    text: "Receive applications, record interviews and register selected applicants as drivers.",
  },
  {
    icon: "activity",
    title: "Reports",
    text: "Review fleet, schedule, fuel and maintenance activity over any date range, and export it.",
  },
];

const PRINCIPLES = [
  {
    title: "Access that matches the role",
    text: "Every request is checked on the server against the user’s role, so people see and do only what their role allows.",
  },
  {
    title: "A record you can trust",
    text: "Important account and sign-in activity is written to an append-only audit trail that administrators can review.",
  },
  {
    title: "Ready on any screen",
    text: "A responsive interface that works on desktop, tablet and mobile, in the office or on the move.",
  },
];

function prefersReducedMotion() {
  return Boolean(
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
}

// Adds "is-in" to every [data-reveal] element as it scrolls into view.
function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const items = root.querySelectorAll("[data-reveal]");

    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      items.forEach((item) => item.classList.add("is-in"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [rootRef]);
}

// Placeholder shown until a real photograph is available.
function CoachArt() {
  return (
    <svg
      className="lp-art"
      viewBox="0 0 800 640"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={HERO_ALT}
    >
      <rect width="800" height="640" fill="#0b1b3a" />
      {[80, 160, 240, 320, 400, 480, 560, 640].map((y) => (
        <line
          key={y}
          x1="0"
          y1={y}
          x2="800"
          y2={y}
          stroke="#ffffff"
          strokeOpacity="0.04"
        />
      ))}
      {[100, 200, 300, 400, 500, 600, 700].map((x) => (
        <line
          key={x}
          x1={x}
          y1="0"
          x2={x}
          y2="640"
          stroke="#ffffff"
          strokeOpacity="0.04"
        />
      ))}
      <line
        x1="0"
        y1="470"
        x2="800"
        y2="470"
        stroke="#27407a"
        strokeWidth="2"
      />
      <line
        x1="40"
        y1="520"
        x2="200"
        y2="520"
        stroke="#27407a"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <line
        x1="300"
        y1="520"
        x2="460"
        y2="520"
        stroke="#27407a"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <line
        x1="560"
        y1="520"
        x2="720"
        y2="520"
        stroke="#27407a"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <ellipse cx="400" cy="478" rx="320" ry="12" fill="#000" opacity="0.25" />
      <rect x="80" y="250" width="640" height="210" rx="28" fill="#f2f4f8" />
      <rect x="80" y="250" width="640" height="20" rx="10" fill="#dfe4ee" />
      {[120, 214, 308, 402, 496].map((x) => (
        <rect
          key={x}
          x={x}
          y="288"
          width="80"
          height="66"
          rx="9"
          fill="#1a2f5e"
        />
      ))}
      <path d="M598 288h72a14 14 0 0 1 14 14v52h-86z" fill="#1a2f5e" />
      <rect x="80" y="372" width="640" height="9" fill="#c9a24d" />
      <rect x="80" y="396" width="640" height="64" rx="0" fill="#e4e8f0" />
      <rect x="690" y="404" width="22" height="14" rx="5" fill="#fff6d6" />
      <circle cx="220" cy="462" r="42" fill="#08142c" />
      <circle cx="220" cy="462" r="18" fill="#8aa0c4" />
      <circle cx="560" cy="462" r="42" fill="#08142c" />
      <circle cx="560" cy="462" r="18" fill="#8aa0c4" />
    </svg>
  );
}

function Brand() {
  return (
    <a
      className="lp-brand"
      href="/"
      onClick={(event) => {
        event.preventDefault();
        window.scrollTo({
          top: 0,
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      }}
      aria-label="Al-Madani Travellers, back to top"
    >
      <span className="lp-brand-mark">
        <Icon name="bus" size={20} />
      </span>
      <span className="lp-brand-text">
        <span className="lp-brand-name">Al-Madani Travellers</span>
        <span className="lp-brand-sub">Transport management</span>
      </span>
    </a>
  );
}

export default function LandingPage({ onAccessPortal }) {
  const rootRef = useRef(null);
  const [imageFailed, setImageFailed] = useState(false);
  useReveal(rootRef);

  // Keeps normal browser behaviour (new tab, copy link) for modified clicks.
  function handlePortalClick(event) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onAccessPortal();
  }

  function handleSectionClick(event, id) {
    event.preventDefault();
    scrollToSection(id);
  }

  return (
    <div className="lp" ref={rootRef}>
      <header className="lp-header">
        <div className="lp-header-in">
          <Brand />
          <nav className="lp-nav" aria-label="Page sections">
            {NAV.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(event) => handleSectionClick(event, item.id)}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <a
            className="lp-btn lp-btn-primary lp-btn-sm"
            href="/login"
            onClick={handlePortalClick}
          >
            Access Portal
          </a>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="lp-hero" aria-labelledby="lp-hero-title">
          <div className="lp-hero-copy">
            <div className="lp-hero-copy-in">
              <p className="lp-eyebrow lp-rise" style={{ "--d": "0.05s" }}>
                Transport management platform
              </p>
              <h1
                className="lp-title lp-rise"
                id="lp-hero-title"
                style={{ "--d": "0.15s" }}
              >
                <span>Smarter Transport.</span>
                <span className="lp-title-accent">Smoother Journeys.</span>
              </h1>
              <p className="lp-lead lp-rise" style={{ "--d": "0.28s" }}>
                Al-Madani Travellers brings vehicles, routes, schedules, drivers
                and the passengers they serve into one secure platform, so every
                journey is planned with clarity and run with confidence.
              </p>
              <div className="lp-actions lp-rise" style={{ "--d": "0.4s" }}>
                <a
                  className="lp-btn lp-btn-primary"
                  href="#services"
                  onClick={(event) => handleSectionClick(event, "services")}
                >
                  Explore Our Services
                  <Icon name="arrowRight" size={16} />
                </a>
                <a
                  className="lp-btn lp-btn-outline"
                  href="/login"
                  onClick={handlePortalClick}
                >
                  Access Portal
                </a>
              </div>
              <ul className="lp-assure lp-rise" style={{ "--d": "0.52s" }}>
                {ASSURANCES.map((item) => (
                  <li key={item}>
                    <Icon name="check" size={16} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="lp-media">
            <div className="lp-frame">
              {imageFailed ? (
                <CoachArt />
              ) : (
                <img
                  src={HERO_IMAGE}
                  alt={HERO_ALT}
                  width="1600"
                  height="1200"
                  fetchPriority="high"
                  decoding="async"
                  onError={() => setImageFailed(true)}
                />
              )}
            </div>
            <div className="lp-badge lp-rise" style={{ "--d": "0.7s" }}>
              <span className="lp-badge-icon">
                <Icon name="shield" size={18} />
              </span>
              <span className="lp-badge-text">
                <strong>Secure by design</strong>
                <span>Role-based access and a full audit trail.</span>
              </span>
            </div>
          </div>
        </section>

        {/* Services */}
        <section
          className="lp-section lp-section-bg"
          id="services"
          aria-labelledby="lp-services-title"
        >
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <p className="lp-eyebrow">Services</p>
              <h2 className="lp-h2" id="lp-services-title">
                One platform for the whole operation.
              </h2>
              <p className="lp-sub">
                Everything your transport team coordinates today across
                registers, spreadsheets and messages, kept together and kept
                consistent.
              </p>
            </div>
            <ul className="lp-grid">
              {SERVICES.map((service, index) => (
                <li
                  key={service.title}
                  data-reveal
                  style={{ "--d": `${(index % 3) * 80}ms` }}
                >
                  <article className="lp-card">
                    <span className="lp-card-icon">
                      <Icon name={service.icon} size={20} />
                    </span>
                    <h3>{service.title}</h3>
                    <p>{service.text}</p>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Platform principles */}
        <section
          className="lp-section"
          id="platform"
          aria-labelledby="lp-platform-title"
        >
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <p className="lp-eyebrow">Platform</p>
              <h2 className="lp-h2" id="lp-platform-title">
                Built for accountability.
              </h2>
              <p className="lp-sub">
                Operational software earns trust through control and
                traceability. These principles are part of the foundation, not
                an afterthought.
              </p>
            </div>
            <ol className="lp-principles">
              {PRINCIPLES.map((item, index) => (
                <li
                  key={item.title}
                  data-reveal
                  style={{ "--d": `${index * 80}ms` }}
                >
                  <span className="lp-num">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="lp-cta lp-dark" aria-labelledby="lp-cta-title">
          <div className="lp-wrap lp-cta-in" data-reveal>
            <div>
              <p className="lp-eyebrow lp-eyebrow-gold">Team portal</p>
              <h2 className="lp-h2 lp-h2-light" id="lp-cta-title">
                Sign in to your Al-Madani Travellers portal.
              </h2>
              <p className="lp-sub lp-sub-light">
                Internal accounts are created and managed by your administrator.
              </p>
            </div>
            <a
              className="lp-btn lp-btn-gold"
              href="/login"
              onClick={handlePortalClick}
            >
              Access Portal
              <Icon name="arrowRight" size={16} />
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <p>
            © {new Date().getFullYear()} Al-Madani Travellers. All rights
            reserved.
          </p>
          <p>Transport management platform</p>
        </div>
      </footer>
    </div>
  );
}
