import { useEffect, useState } from 'react';
import { MethodologyPage } from './report/MethodologyPage';
import { ReportPage } from './report/ReportPage';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHashRoute();
  return (
    <div className="app">
      <nav className="topnav">
        <a href="#/" className="wordmark">
          chesscheatmetrics
        </a>
        <a href="#/methodology">methodology</a>
      </nav>
      <main>{hash === '#/methodology' ? <MethodologyPage /> : <ReportPage />}</main>
      <footer className="site-footer muted small">
        <p>Not affiliated with lichess or chess.com. Engine analysis runs in your browser.</p>
      </footer>
    </div>
  );
}
