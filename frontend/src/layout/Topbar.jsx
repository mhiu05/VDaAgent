import React from "react";
import { Bell, CircleHelp, LogOut, Plus, Search, UserRound } from "lucide-react";

export function Topbar({ onNewProfile, session, onLogout }) {
  return (
    <header className="topbar">
      <div className="topbar-product">
        <p className="fabric-breadcrumb">Fabric Orchestrator</p>
        <h1>Fabric Data</h1>
      </div>
      <label className="topbar-search">
        <Search size={15} />
        <input type="search" placeholder="Search workspace..." aria-label="Search workspace" />
      </label>
      <div className="topbar-actions">
        <button className="primary-button topbar-primary-action" type="button" onClick={onNewProfile}>
          <Plus size={16} /> New Profile
        </button>
        <button className="topbar-icon-action" type="button" title="Help" aria-label="Help">
          <CircleHelp size={16} />
        </button>
        <button className="topbar-icon-action" type="button" title="Notifications" aria-label="Notifications">
          <Bell size={16} />
        </button>
        {session ? (
          <div className="topbar-user">
            <span className="topbar-user-icon"><UserRound size={16} /></span>
            <span>
              <strong>{session.displayName}</strong>
              <small>{session.role}</small>
            </span>
            <button className="icon-button" type="button" onClick={onLogout} title="Sign out" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
