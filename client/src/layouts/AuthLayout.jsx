import Icon from "../components/Icon.jsx";

// Original illustration drawn with SVG: a stylised bus on a route line.
function BusIllustration() {
  return (
    <svg
      className="bm-bus"
      viewBox="0 0 520 280"
      role="img"
      aria-label="Illustration of a bus on a route"
    >
      <path
        d="M16 54 C 130 12, 250 86, 360 44 S 480 30, 506 52"
        fill="none"
        stroke="#3b5a97"
        strokeWidth="2"
        strokeDasharray="3 8"
        strokeLinecap="round"
      />
      <circle
        cx="16"
        cy="54"
        r="6"
        fill="#0b1b3a"
        stroke="#6f8fcf"
        strokeWidth="2"
      />
      <circle
        cx="262"
        cy="64"
        r="6"
        fill="#0b1b3a"
        stroke="#6f8fcf"
        strokeWidth="2"
      />
      <circle cx="506" cy="52" r="6" fill="#f6b73c" />
      <line
        x1="0"
        y1="252"
        x2="520"
        y2="252"
        stroke="#27407a"
        strokeWidth="2"
      />
      <line
        x1="30"
        y1="266"
        x2="110"
        y2="266"
        stroke="#27407a"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <line
        x1="170"
        y1="266"
        x2="250"
        y2="266"
        stroke="#27407a"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <line
        x1="310"
        y1="266"
        x2="390"
        y2="266"
        stroke="#27407a"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect x="60" y="80" width="400" height="144" rx="22" fill="#f6b73c" />
      <rect x="60" y="80" width="400" height="18" rx="9" fill="#e29a14" />
      {[84, 148, 212, 276, 340].map((x) => (
        <rect
          key={x}
          x={x}
          y="112"
          width="52"
          height="48"
          rx="8"
          fill="#cfe3ff"
        />
      ))}
      <path d="M404 112h30a10 10 0 0 1 10 10v38h-40z" fill="#cfe3ff" />
      <rect
        x="60"
        y="176"
        width="400"
        height="10"
        fill="#0b1b3a"
        opacity="0.85"
      />
      <circle cx="448" cy="202" r="8" fill="#fff6d6" />
      <circle cx="140" cy="226" r="30" fill="#0b1b3a" />
      <circle cx="140" cy="226" r="13" fill="#8aa0c4" />
      <circle cx="380" cy="226" r="30" fill="#0b1b3a" />
      <circle cx="380" cy="226" r="13" fill="#8aa0c4" />
    </svg>
  );
}

const POINTS = [
  { icon: "shield", text: "Role-based access, enforced by the server" },
  { icon: "clock", text: "An audit trail of important changes" },
  { icon: "bus", text: "Works on desktop, tablet and mobile" },
];

// Shared by Login now, and by a future Sign Up page.
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="bm-auth">
      <aside className="bm-auth-brand">
        <div className="bm-logo">
          <span className="bm-logo-mark">
            <Icon name="bus" size={20} />
          </span>
          <span className="bm-logo-name">Bus Management System</span>
        </div>

        <div className="bm-brand-copy">
          <p className="bm-brand-headline">
            Keep every bus, driver and route in step.
          </p>
          <p className="bm-brand-text">
            One place to coordinate your fleet, drivers, routes and schedules.
          </p>
        </div>

        <BusIllustration />

        <ul className="bm-brand-points">
          {POINTS.map((point) => (
            <li key={point.text}>
              <Icon name={point.icon} size={16} />
              {point.text}
            </li>
          ))}
        </ul>
      </aside>

      <main className="bm-auth-panel">
        <div className="bm-auth-card">
          <h1 className="bm-auth-title">{title}</h1>
          {subtitle && <p className="bm-auth-sub">{subtitle}</p>}
          {children}
        </div>
        {footer && <p className="bm-auth-foot">{footer}</p>}
      </main>
    </div>
  );
}
