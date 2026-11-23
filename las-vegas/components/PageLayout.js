// components/PageLayout.js
import Header from './Header';
import GlobalLoader from './GlobalLoader';

export default function PageLayout({ user, children }) {
  if (!user) return <GlobalLoader />;

  return (
    <div className="site-page-shell">
      <div className="fib-atmosphere" aria-hidden="true">
        <span className="fib-atmosphere__grid" />
        <span className="fib-atmosphere__glow fib-atmosphere__glow--gold" />
        <span className="fib-atmosphere__glow fib-atmosphere__glow--red" />
        <span className="fib-atmosphere__seal">FBI</span>
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
            radial-gradient(ellipse at 50% -12%, rgba(197, 163, 106, .10), transparent 48rem),
            linear-gradient(180deg, #0b0c0e 0%, #08090b 58%, #070809 100%);
        }
        .fib-atmosphere {
          position: fixed;
          inset: 0;
          z-index: -1;
          overflow: hidden;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(197, 163, 106, .025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(197, 163, 106, .025) 1px, transparent 1px);
          background-size: 72px 72px;
          mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,.7) 60%, transparent 100%);
        }
        .fib-atmosphere__glow {
          position: absolute;
          width: min(58vw, 760px);
          aspect-ratio: 1;
          border-radius: 50%;
          filter: blur(115px);
          opacity: .42;
        }
        .fib-atmosphere__glow--gold {
          top: -38vw;
          left: -18vw;
          background: radial-gradient(circle, rgba(197,163,106,.19), transparent 68%);
        }
        .fib-atmosphere__glow--red {
          right: -28vw;
          bottom: -42vw;
          background: radial-gradient(circle, rgba(166,75,82,.13), transparent 70%);
        }
        .fib-atmosphere__seal {
          position: absolute;
          right: 5vw;
          top: 23vh;
          display: grid;
          place-items: center;
          width: clamp(180px, 27vw, 390px);
          aspect-ratio: 1;
          border: 1px solid rgba(197,163,106,.055);
          border-radius: 50%;
          color: rgba(197,163,106,.035);
          font: 600 clamp(46px, 8vw, 112px)/1 'Space Grotesk', sans-serif;
          letter-spacing: .12em;
          box-shadow: 0 0 0 18px rgba(197,163,106,.012), 0 0 0 38px rgba(197,163,106,.009), inset 0 0 70px rgba(197,163,106,.018);
          transform: rotate(-12deg);
        }
        .site-page-content { position: relative; z-index: 1; }
        @media (max-width: 700px) {
          .fib-atmosphere { background-size: 48px 48px; }
          .fib-atmosphere__seal { top: 18vh; right: -70px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fib-atmosphere__glow { filter: blur(70px); }
        }
      `}</style>
    </div>
  );
}
