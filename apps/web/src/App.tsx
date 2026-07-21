import { useEffect, useState } from 'react';
import { MethodologyPage } from './report/MethodologyPage';
import { ReportPage } from './report/ReportPage';

function usePathRoute(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export default function App() {
  const path = usePathRoute();
  const isMethodology = path === '/methodology';

  // old share links used hash routes (#/u/..., #/methodology); map them to real paths
  useEffect(() => {
    const { hash } = window.location;
    if (hash.startsWith('#/')) window.location.replace(hash.slice(1));
  }, []);

  useEffect(() => {
    document.title = isMethodology
      ? 'Methodology - Chess Cheat Detection'
      : 'Chess Cheat Detection - is that account playing like a human?';
  }, [isMethodology]);

  return (
    <div className="app">
      <nav className="topnav">
        <a href="/" className="wordmark">
          chesscheatdetection
        </a>
        <a href="/methodology">methodology</a>
      </nav>
      <main>{isMethodology ? <MethodologyPage /> : <ReportPage />}</main>
      <footer className="site-footer muted small">
        <p>Not affiliated with lichess or chess.com. Engine analysis runs in your browser.</p>
      </footer>
    </div>
  );
}
