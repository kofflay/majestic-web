import LasVegasHeader from './LasVegasHeader';
import GlobalLoader from './GlobalLoader';

export default function LasVegasPageLayout({ user, children }) {
  if (!user) return <GlobalLoader />;
  return (
    <div className="site-page-shell">
      <LasVegasHeader user={user} />
      <main className="site-page-content">{children}</main>
    </div>
  );
}
