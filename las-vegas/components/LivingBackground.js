// components/LivingBackground.js
export default function LivingBackground() {
  return (
    <div className="living-bg-container">
      <div className="glow-orb blue-orb"></div>
      <div className="glow-orb red-orb"></div>
      <div className="glow-orb purple-orb"></div>

      <style jsx>{`
        .living-bg-container {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
          background: transparent;
        }

        .glow-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          will-change: transform;
        }

        .blue-orb {
          width: 50vw;
          height: 50vw;
          background: radial-gradient(
            circle,
            rgba(63, 131, 248, 0.09) 0%,
            rgba(63, 131, 248, 0.045) 42%,
            rgba(63, 131, 248, 0) 72%
          );
          top: -10%;
          left: -10%;
          animation: float-blue 25s ease-in-out infinite alternate;
        }

        .red-orb {
          width: 45vw;
          height: 45vw;
          background: radial-gradient(
            circle,
            rgba(255, 38, 64, 0.075) 0%,
            rgba(255, 38, 64, 0.035) 42%,
            rgba(255, 38, 64, 0) 72%
          );
          bottom: -15%;
          right: -10%;
          animation: float-red 30s ease-in-out infinite alternate;
        }

        .purple-orb {
          width: 40vw;
          height: 40vw;
          background: radial-gradient(
            circle,
            rgba(158, 107, 255, 0.045) 0%,
            rgba(158, 107, 255, 0.02) 42%,
            rgba(158, 107, 255, 0) 72%
          );
          top: 40%;
          left: 30%;
          animation: float-purple 20s ease-in-out infinite alternate;
        }

        @keyframes float-blue {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(15vw, 10vh) scale(1.1); }
        }

        @keyframes float-red {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-10vw, -15vh) scale(1.2); }
        }

        @keyframes float-purple {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(5vw, -10vh) scale(1.3); }
        }
      `}</style>
    </div>
  );
}
