// components/StaffCard.js
export default function StaffCard({ member, onDelete, isAdminView }) {
  if (!isAdminView) {
    return (
      <div
        style={{
          width: 'min(308px, 100%)',
          minHeight: '505px',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          textAlign: 'center',
          color: '#f5f5f5',
          fontFamily: "'Inter', sans-serif",
          backgroundColor: '#171717',
          backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.045) 0, rgba(255,255,255,.045) 1px, transparent 1px, transparent 10px)',
          border: '1px solid #303030',
          borderRadius: '27px',
          boxShadow: '0 16px 42px rgba(0,0,0,.28)',
          transition: 'transform .2s ease, border-color .2s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-4px)';
          e.currentTarget.style.borderColor = 'rgba(255, 0, 76, .65)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.borderColor = '#303030';
        }}
      >
        <div style={{
          position: 'absolute', top: 0, right: 0, padding: '6px 15px 7px',
          background: '#ed0050', color: '#fff', fontSize: '12px',
          fontWeight: 800, letterSpacing: '.06em', borderRadius: '0 0 0 13px',
          boxShadow: '0 3px 14px rgba(237,0,80,.22)',
        }}>TOP SECRET</div>

        <div style={{
          height: '220px', display: 'grid', placeItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,.09)',
          paddingTop: '28px',
        }}>
          <div style={{
            width: '106px', height: '106px', borderRadius: '22px',
            display: 'grid', placeItems: 'center',
            background: '#202020', border: '1px solid #383838',
          }}>
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#f4f4f4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
        </div>

        <div style={{ padding: '18px 18px 16px', borderBottom: '1px solid rgba(255,255,255,.09)' }}>
          <div style={{ color: '#9ca3af', fontSize: '10px', letterSpacing: '.1em', marginBottom: '8px' }}>AGENT NAME</div>
          <div style={{ color: '#fff', fontSize: '19px', fontWeight: 800, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{member.name}</div>
          <div style={{ color: '#9ca3af', fontSize: '10px', letterSpacing: '.1em', margin: '18px 0 8px' }}>POSITION</div>
          <div style={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere', background: getRankGradient(member.rank), WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{member.rank}</div>
        </div>

        <div style={{ padding: '18px 16px', borderBottom: '1px solid rgba(255,255,255,.09)' }}>
          <div style={{ color: '#9ca3af', fontSize: '10px', letterSpacing: '.1em', marginBottom: '8px' }}>CONTACT · DISCORD</div>
          <div style={{ color: '#ff0755', fontSize: '14px', fontWeight: 700, overflowWrap: 'anywhere' }}>{member.discord}</div>
        </div>

        <div style={{
          marginTop: 'auto', padding: '18px 12px 20px',
          color: '#a3a3a3', fontSize: '11px', letterSpacing: '.04em',
        }}>CLASSIFIED // NOFORN</div>
      </div>
    );
  }

  const getRankGradient = (rank) => {
    if (rank === 'Chief of Police') return 'linear-gradient(45deg, #9e6bff, #9fc1ff)';
    if (rank === 'Deputy Chief') return 'linear-gradient(45deg, #2a2b36, #a0a3ce)';
    return 'linear-gradient(45deg, #8b8ba7, #ffffff)';
  };

  const cardStyle = isAdminView ? {
    width: '100%',
    minWidth: 0,
    maxWidth: '340px',
    minHeight: '330px',
    background: 'rgba(11, 15, 22, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.15)',
    borderRadius: '4px',
    padding: '24px 20px',
    position: 'relative',
    textAlign: 'center',
    fontFamily: "'Montserrat', 'Inter', -apple-system, sans-serif",
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'none',
    transition: 'border-color 0.2s ease, transform 0.2s ease',
  } : {
    width: '260px',
    minHeight: '330px',
    background: 'linear-gradient(160deg, rgba(17, 25, 38, .96), rgba(9, 13, 20, .94))',
    border: '1px solid rgba(148, 163, 184, .16)',
    borderRadius: '7px',
    padding: '24px 20px',
    position: 'relative',
    textAlign: 'center',
    fontFamily: "'Inter', sans-serif",
    boxShadow: '0 18px 48px rgba(0,0,0,.2)',
    transition: 'border-color .2s ease, transform .2s ease, box-shadow .2s ease',
  };

  const badgeStyle = isAdminView ? {
    alignSelf: 'center',
    marginBottom: '16px',
    background: 'rgba(255, 38, 64, 0.1)',
    border: '1px solid rgba(255, 38, 64, 0.3)',
    color: '#ff6b7d',
    fontSize: '9px',
    fontWeight: '700',
    padding: '5px 9px',
    letterSpacing: '0.12em',
    fontFamily: "'DM Mono', monospace",
  } : {
    position: 'absolute',
    top: '14px',
    right: '14px',
    background: 'rgba(63, 131, 248, .13)',
    border: '1px solid rgba(63, 131, 248, .28)',
    borderRadius: '4px',
    color: '#8dbaff',
    fontSize: '9px',
    fontWeight: '700',
    padding: '5px 8px',
    letterSpacing: '.1em',
    textTransform: 'uppercase',
  };

  const avatarStyle = isAdminView
    ? { width: '80px', height: '80px', borderRadius: '8px', margin: '0 auto 18px', display: 'block', border: '1px solid rgba(148,163,184,0.2)', objectFit: 'cover' }
    : { width: '82px', height: '82px', borderRadius: '9px', margin: '10px auto 20px auto', display: 'block', border: '1px solid rgba(148,163,184,.22)', objectFit: 'cover' };

  const labelStyle = isAdminView
    ? { color: '#7f8a9a', fontSize: '10px', letterSpacing: '0.14em', marginBottom: '6px', fontFamily: "'DM Mono', monospace" }
    : { color: '#8293aa', fontSize: '9px', letterSpacing: '.14em', marginBottom: '6px', fontFamily: "'DM Mono', monospace" };

  const nameStyle = isAdminView
    ? { color: '#f5f7fb', fontSize: '17px', fontWeight: '700', marginBottom: '18px', overflowWrap: 'anywhere', fontFamily: "'Space Grotesk', sans-serif" }
    : { color: '#f2f6fc', fontSize: '18px', fontWeight: '700', marginBottom: '18px', fontFamily: "'Space Grotesk', sans-serif", overflowWrap: 'anywhere' };

  const rankStyle = isAdminView
    ? { fontSize: '13px', fontWeight: '700', marginBottom: '18px', background: getRankGradient(member.rank), WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', overflowWrap: 'anywhere' }
    : { fontSize: '13px', fontWeight: '700', marginBottom: '18px', background: getRankGradient(member.rank), WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', overflowWrap: 'anywhere' };

  const discordStyle = isAdminView
    ? { color: '#8db8ff', fontSize: '12px', marginBottom: '20px', overflowWrap: 'anywhere' }
    : { color: '#8db8ff', fontSize: '12px', marginBottom: '20px', overflowWrap: 'anywhere' };

  const footerStyle = isAdminView
    ? { marginTop: 'auto', borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: '14px', color: '#64748b', fontSize: '9px', letterSpacing: '0.12em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', fontFamily: "'DM Mono', monospace" }
    : { borderTop: '1px solid rgba(148,163,184,.14)', paddingTop: '14px', color: '#64758c', fontSize: '9px', letterSpacing: '.12em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: "'DM Mono', monospace" };

  return (
    <div
      style={cardStyle}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.borderColor = 'rgba(63, 131, 248, 0.5)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.15)';
      }}
    >
      <div style={badgeStyle}>HIGH COMMAND</div>

      {member.avatar ? (
        <img src={member.avatar} alt={member.name} style={avatarStyle} />
      ) : (
        <div style={isAdminView
          ? { width: '80px', height: '80px', borderRadius: '8px', margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(148,163,184,0.2)', background: 'rgba(0,0,0,0.25)' }
          : { width: '80px', height: '80px', borderRadius: '16px', margin: '10px auto 20px auto', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #333', background: '#1a1a1a' }
        }>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isAdminView ? "#64748b" : "#555"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        </div>
      )}

      <div style={labelStyle}>ИМЯ</div>
      <div style={nameStyle}>{member.name}</div>

      <div style={labelStyle}>ДОЛЖНОСТЬ</div>
      <div style={rankStyle}>{member.rank}</div>

      <div style={labelStyle}>DISCORD</div>
      <div style={discordStyle}>{member.discord}</div>

      <div style={footerStyle}>
        <span>LSPD INTRANET</span>
        {isAdminView && (
          <button type="button" onClick={() => onDelete(member.id)} style={{ background: 'transparent', border: 'none', color: '#ff6b7d', cursor: 'pointer', fontSize: '10px', fontWeight: '700', fontFamily: "'DM Mono', monospace", padding: '6px 0' }}>
            [ УДАЛИТЬ ]
          </button>
        )}
      </div>
    </div>
  );
}
