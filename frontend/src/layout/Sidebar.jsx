import React from "react";
import { CheckCircle2, Loader2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { navItems } from "../utils/options.js";

export function Sidebar({ activeView, setActiveView, loading, collapsed, setCollapsed }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">P</div>
        <div className="brand-copy">
          <strong>Profiling Agent</strong>
          <span>Data quality workspace</span>
        </div>
        <button className="sidebar-collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map(([id, Icon, label]) => (
          <button
            key={id}
            className={`nav-item ${activeView === id ? "active" : ""}`}
            onClick={() => setActiveView(id)}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-status">
        {loading ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
        <span>{loading || "Ready"}</span>
      </div>
    </aside>
  );
}
