// components/PageLayout.js
import Header from './Header';
import GlobalLoader from './GlobalLoader';

export default function PageLayout({ user, children }) {
  if (!user) return <GlobalLoader />;

  return (
    <div className="site-page-shell">
      <div className="lspd-atmosphere" aria-hidden="true">
        <span className="lspd-atmosphere__grid" />
        <span className="lspd-atmosphere__glow lspd-atmosphere__glow--gold" />
        <span className="lspd-atmosphere__glow lspd-atmosphere__glow--red" />
        <span className="lspd-atmosphere__seal">LSPD</span>
      </div>
      <Header user={user} />
      <main className="site-page-content">{children}</main>
      <style jsx global>{`
        .site-page-shell {
          position: relative;
          isolation: isolate;
          min-height: 100vh;
          overflow: clip;
          background:
            radial-gradient(ellipse at 50% -12%, rgba(197, 163, 106, .19), transparent 48rem),
            linear-gradient(180deg, #171716 0%, #121314 58%, #0e1011 100%);
        }
        .lspd-atmosphere {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(215, 183, 122, .045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(215, 183, 122, .045) 1px, transparent 1px);
          background-size: 72px 72px;
          mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,.7) 60%, transparent 100%);
        }
        .lspd-atmosphere__glow {
          position: absolute;
          width: min(58vw, 760px);
          aspect-ratio: 1;
          border-radius: 50%;
          filter: blur(115px);
          opacity: .62;
        }
        .lspd-atmosphere__glow--gold {
          top: -38vw;
          left: -18vw;
          background: radial-gradient(circle, rgba(215,183,122,.3), transparent 68%);
        }
        .lspd-atmosphere__glow--red {
          right: -28vw;
          bottom: -42vw;
          background: radial-gradient(circle, rgba(166,75,82,.18), transparent 70%);
        }
        .lspd-atmosphere__seal {
          position: absolute;
          right: 5vw;
          top: 23vh;
          display: grid;
          place-items: center;
          width: clamp(180px, 27vw, 390px);
          aspect-ratio: 1;
          border: 1px solid rgba(197,163,106,.055);
          border-radius: 50%;
          color: rgba(197,163,106,.07);
          font: 600 clamp(46px, 8vw, 112px)/1 'Space Grotesk', sans-serif;
          letter-spacing: .12em;
          box-shadow: 0 0 0 18px rgba(197,163,106,.012), 0 0 0 38px rgba(197,163,106,.009), inset 0 0 70px rgba(197,163,106,.018);
          transform: rotate(-12deg);
        }
        .site-page-content { position: relative; z-index: 1; }
        @media (max-width: 700px) {
          .lspd-atmosphere { background-size: 48px 48px; }
          .lspd-atmosphere__seal { top: 18vh; right: -70px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lspd-atmosphere__glow { filter: blur(70px); }
        }
      `}</style>
    </div>
  );
}
