import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { createServices, readServiceMode, ServiceConfigurationError } from "./app/services/create-services";
import { createApiHybridServices } from "./adapters/api/create-api-services";
import "./shared/styles/globals.css";
const root = createRoot(document.getElementById("root")!);
try {
  // hybrid: the API adapters in adapters/api (agent chat included) over the mock services.
  const services = createServices(readServiceMode(import.meta.env.VITE_SERVICE_MODE), {
    hybrid: () => createApiHybridServices({ base: import.meta.env.VITE_API_BASE ?? "" }),
  });
  root.render(<StrictMode><App services={services} /></StrictMode>);
} catch (error) {
  if (!(error instanceof ServiceConfigurationError)) throw error;
  root.render(<main role="alert" style={{ padding: '2rem', maxWidth: '48rem', margin: 'auto' }}>
    <h1>Không thể khởi động / Unable to start</h1>
    <p>Kiểm tra cấu hình dịch vụ ứng dụng. / Check the application service configuration.</p>
    <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
  </main>);
}
