import React from "react";
import { Plus } from "lucide-react";

export function Topbar({ onNewProfile }) {
  return (
    <header className="topbar">
      <div>
        <p className="fabric-breadcrumb">Workspaces / Data quality</p>
        <h1>Profiling Agent Platform</h1>
      </div>
      <button className="primary-button topbar-primary-action" type="button" onClick={onNewProfile}>
        <Plus size={16} /> New profiling
      </button>
    </header>
  );
}
