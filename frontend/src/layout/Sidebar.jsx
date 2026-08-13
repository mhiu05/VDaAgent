import React from "react";
import { CheckCircle2, Loader2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { navItems } from "../utils/options.js";

export function Sidebar({ activeView, setActiveView, loading, collapsed, setCollapsed, onResizeStart }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">FD</div>
        <div className="brand-copy">
          <strong>Fabric Data</strong>
          <span>Intelligence Surface</span>
        </div>
        <button
          className="sidebar-collapse-button"
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <nav className="nav-list" aria-label="Primary navigation">
        {navItems.map(([id, Icon, label]) => (
          <button
            key={id}
            className={`nav-item ${activeView === id ? "active" : ""}`}
            type="button"
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
      <button
        className="sidebar-resize-handle"
        type="button"
        onMouseDown={onResizeStart}
        aria-label="Resize sidebar"
        title="Resize sidebar"
      />
    </aside>
  );
}
