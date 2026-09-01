// Dev-mode default only — served as-is by `npm run dev` and by `vite build`'s output. The
// Docker image's docker-entrypoint.sh overwrites this file at container *start* from the
// real API_URL env var; this checked-in copy never reaches a real deployment.
window.__ORKES_CONFIG__ = {
  API_URL: 'http://localhost:8000',
}
