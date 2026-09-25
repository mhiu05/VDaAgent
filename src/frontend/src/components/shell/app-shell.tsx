'use client';

import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Building2,
  CalendarClock,
  ChevronDown,
  Database,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Workflow,
  X,
} from 'lucide-react';
import type { Role, Session } from '@vda/contracts';
import { workspaceRouteHref, type ShellSection, type WorkspaceRoute } from './routes';

const roleLabels: Record<Role, string> = {
  owner: 'Chủ sở hữu',
  analyst: 'Chuyên viên phân tích',
  viewer: 'Người xem',
};

const navigation: Array<{
  section: ShellSection;
  route: WorkspaceRoute;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { section: 'workspace', route: { page: 'workspace' }, label: 'Tổng quan', icon: LayoutDashboard },
  { section: 'chat', route: { page: 'chat' }, label: 'Trợ lý AI', icon: MessageSquareText },
  { section: 'runs', route: { page: 'runs' }, label: 'Lượt chạy', icon: Activity },
  { section: 'reports', route: { page: 'reports' }, label: 'Báo cáo', icon: FileText },
  { section: 'imports', route: { page: 'imports' }, label: 'Dữ liệu', icon: Database },
  { section: 'automations', route: { page: 'automations' }, label: 'Lịch tự động', icon: CalendarClock },
];

export function AppShell({
  section,
  title,
  eyebrow,
  description,
  session,
  organization,
  setOrgId,
  onLogout,
  statusText,
  capabilityRail,
  feedback,
  contextSlot,
  presentation = 'standard',
  pageHeader = true,
  children,
}: {
  section: ShellSection;
  title: string;
  eyebrow: string;
  description: string;
  session: Session;
  organization: Session['organizations'][number];
  setOrgId: (id: string) => void;
  onLogout: () => Promise<void>;
  statusText: string;
  capabilityRail?: ReactNode;
  feedback?: ReactNode;
  contextSlot?: ReactNode;
  presentation?: 'standard' | 'analytical';
  pageHeader?: boolean;
  children: ReactNode;
}) {
  const mobileNavigation = useRef<HTMLDialogElement>(null);
  const mobileNavTrigger = useRef<HTMLButtonElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function closeMobileNavigation() {
    mobileNavigation.current?.close();
    setMobileNavOpen(false);
  }

  return (
    <div className={`app-shell ${presentation === 'analytical' ? 'app-shell-analytical' : ''}`}>
      <a className="skip-link" href="#main-content">
        Đến nội dung chính
      </a>
      <aside className="sidebar">
        <Link className="brand" href={workspaceRouteHref({ page: 'workspace' }, organization.org_id)}>
          <span className="brand-mark">V</span>
          <span>
            VDaAgent<span className="brand-sub">SAKURA SIGNAL · DATA STUDIO</span>
          </span>
        </Link>
        {presentation === 'analytical' && (
          <details className="analytical-account">
            <summary aria-label="Workspace và tài khoản" title="Workspace và tài khoản">
              <Building2 size={20} aria-hidden="true" />
            </summary>
            <div className="analytical-account-menu">
              <label>
                Workspace hiện tại
                <select value={organization.org_id} onChange={(event) => setOrgId(event.target.value)}>
                  {session.organizations.map((item) => <option key={item.org_id} value={item.org_id}>{item.name}</option>)}
                </select>
              </label>
              <span>{roleLabels[organization.role]}</span>
              <button type="button" onClick={() => void onLogout()}><LogOut size={16} /> Đăng xuất</button>
            </div>
          </details>
        )}
        {presentation === 'standard' && <div className="workspace-picker">
          <Building2 size={20} />
          <label>
            <span className="sr-only">Workspace hiện tại</span>
            <select value={organization.org_id} onChange={(event) => setOrgId(event.target.value)}>
              {session.organizations.map((item) => (
                <option key={item.org_id} value={item.org_id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span>{roleLabels[organization.role]}</span>
          </label>
          <ChevronDown size={14} />
        </div>}
        {capabilityRail}
        <p className="nav-caption">{capabilityRail ? 'NGUỒN LỰC' : 'KHÔNG GIAN LÀM VIỆC'}</p>
        <nav aria-label="Điều hướng workspace">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.section === section;
            return (
              <Link
                key={item.section}
                className={`nav-item ${active ? 'active' : ''}`}
                href={workspaceRouteHref(item.route, organization.org_id)}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
              >
                <Icon size={18} />
                {item.label}
                {active && <span className="nav-dot" />}
              </Link>
            );
          })}
        </nav>
        {presentation === 'standard' && <div className="sidebar-bottom">
          <div className="trust-note">
            <Workflow size={22} />
            <strong>Mọi con số đều có nguồn.</strong>
            <p>Từ snapshot đến báo cáo, luôn giữ nguyên chuỗi bằng chứng.</p>
            <span className="badge">SUPABASE</span>
          </div>
          <div className="user-row">
            <span className="avatar">{organization.role.slice(0, 1).toUpperCase()}</span>
            <span className="user-identity">
            <strong>{roleLabels[organization.role]}</strong>
              <small title={session.email}>{session.email}</small>
            </span>
            <button className="icon-button" aria-label="Đăng xuất" onClick={() => void onLogout()}>
              <LogOut size={17} />
            </button>
          </div>
        </div>}
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            ref={mobileNavTrigger}
            className="mobile-nav-trigger"
            type="button"
            aria-label="Mở điều hướng"
            aria-haspopup="dialog"
            aria-expanded={mobileNavOpen}
            onClick={() => {
              mobileNavigation.current?.showModal();
              setMobileNavOpen(true);
            }}
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <div className="breadcrumbs">
            VDaAgent <span>/</span> <strong>{title}</strong>
          </div>
          <div className="topbar-status">
            <span className="live-dot" />
            {statusText}
            <span className="badge">{roleLabels[organization.role]}</span>
          </div>
        </header>
        <dialog
          ref={mobileNavigation}
          className="mobile-nav-dialog"
          aria-label="Điều hướng workspace"
          onClose={() => {
            setMobileNavOpen(false);
            mobileNavTrigger.current?.focus();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeMobileNavigation();
          }}
        >
          <div className="mobile-nav-header">
            <Link
              className="brand"
              href={workspaceRouteHref({ page: 'workspace' }, organization.org_id)}
              onClick={closeMobileNavigation}
            >
              <span className="brand-mark">V</span>
              <span>
                VDaAgent<span className="brand-sub">SAKURA SIGNAL · DATA STUDIO</span>
              </span>
            </Link>
            <button
              className="mobile-nav-close"
              type="button"
              aria-label="Đóng điều hướng"
              onClick={closeMobileNavigation}
            >
              <X size={19} aria-hidden="true" />
            </button>
          </div>
          <div className="workspace-picker">
            <Building2 size={20} aria-hidden="true" />
            <label>
              Workspace hiện tại
              <select
                value={organization.org_id}
                onChange={(event) => {
                  setOrgId(event.target.value);
                  closeMobileNavigation();
                }}
              >
                {session.organizations.map((item) => (
                  <option key={item.org_id} value={item.org_id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <nav aria-label="Điều hướng workspace">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = item.section === section;
              return (
                <Link
                  key={item.section}
                  className={`nav-item ${active ? 'active' : ''}`}
                  href={workspaceRouteHref(item.route, organization.org_id)}
                  aria-current={active ? 'page' : undefined}
                  onClick={closeMobileNavigation}
                >
                  <Icon size={18} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mobile-nav-user">
            <span className="user-identity">
              <strong>{roleLabels[organization.role]}</strong>
              <small title={session.email}>{session.email}</small>
            </span>
            <button
              className="mobile-nav-close"
              type="button"
              aria-label="Đăng xuất"
              onClick={() => {
                closeMobileNavigation();
                void onLogout();
              }}
            >
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </dialog>
        <main id="main-content" className="main-content">
          {pageHeader && (
            <header className="page-heading">
              <div>
                <span className="eyebrow">{eyebrow}</span>
                <h1>{title}</h1>
                <p>{description}</p>
              </div>
            </header>
          )}
          {feedback}
          {children}
          {contextSlot}
          <footer className="workspace-footer">
            <span>VDaAgent · Bản MVP cục bộ</span>
            <span>Dữ liệu → Phân tích → Bằng chứng → Nhận định → Báo cáo</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
