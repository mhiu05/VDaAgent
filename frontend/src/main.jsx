const rootElement = document.getElementById("root");
rootElement.textContent = "Starting Profiling Agent Platform...";

Promise.all([
  import("react"),
  import("react-dom/client"),
  import("./App.jsx"),
  import("./shared/ErrorBoundary.jsx"),
  import("./styles/index.css"),
])
  .then(([ReactModule, ReactDomModule, AppModule, ErrorBoundaryModule]) => {
    const React = ReactModule.default;
    const { createRoot } = ReactDomModule;
    const App = AppModule.default;
    const { ErrorBoundary } = ErrorBoundaryModule;

    createRoot(rootElement).render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          ErrorBoundary,
          null,
          React.createElement(App),
        ),
      ),
    );
  })
  .catch((error) => {
    rootElement.innerHTML = `
      <div class="fatal-error">
        <strong>Frontend bootstrap error</strong>
        <pre>${escapeHtml(error?.stack || error?.message || String(error))}</pre>
      </div>
    `;
  });

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
