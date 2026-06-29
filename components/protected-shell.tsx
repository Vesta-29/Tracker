"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ClipboardList, KeyRound, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Pencil, RadioTower, Settings, Upload, Wrench, X } from "lucide-react";
import { changePassword, signOut, updateOwnProfile } from "@/lib/supabase-repository";
import type { Profile } from "@/lib/types";
import { ChangeDisplayNameModal, ChangePasswordModal, ConfirmLogoutModal, invalidateRouteWorkspaceCache } from "@/components/tracker-app";
import DialogFocusManager from "@/components/dialog-focus-manager";
import { GuardedNavigationProvider, useGuardedNavigation } from "@/lib/guarded-navigation";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sites", label: "Sites", icon: ClipboardList },
  { href: "/service-visits", label: "Service visits", icon: Wrench },
  { href: "/import", label: "Import sites", icon: Upload },
  { href: "/admin/contractors", label: "Admin settings", icon: Settings },
] as const;

function activeRoute(pathname: string, href: string) {
  if (href === "/sites") return pathname.startsWith("/sites");
  if (href === "/service-visits") return pathname.startsWith("/service-visits");
  if (href === "/admin/contractors") return pathname.startsWith("/admin/");
  return pathname === href;
}

function useEscape(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    function keydown(event: KeyboardEvent) { if (event.key === "Escape") onEscape(); }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, onEscape]);
}

export default function ProtectedShell({ initialProfile, children }: { initialProfile: Profile; children: React.ReactNode }) {
  return <GuardedNavigationProvider><ProtectedShellContent initialProfile={initialProfile}>{children}</ProtectedShellContent></GuardedNavigationProvider>;
}

function ProtectedShellContent({ initialProfile, children }: { initialProfile: Profile; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const navigate = useGuardedNavigation();
  const [profile, setProfile] = useState(initialProfile);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("fieldtrack:sidebar-collapsed") === "true");
  const [accountMenu, setAccountMenu] = useState(false);
  const [nameModal, setNameModal] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [logoutModal, setLogoutModal] = useState(false);
  const [toast, setToast] = useState("");
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountItemsRef = useRef<HTMLDivElement>(null);
  const notify = (message: string) => { setToast(message); setTimeout(() => setToast(""), 3000); };
  const availableNav = profile.role === "admin" ? nav : nav.filter((item) => item.href !== "/admin/contractors" && (profile.role !== "guest" || item.href !== "/import"));
  useEffect(() => {
    window.localStorage.setItem("fieldtrack:sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEscape(() => setMobileMenu(false), mobileMenu);
  useEscape(() => setAccountMenu(false), accountMenu);
  useEscape(() => setNameModal(false), nameModal);
  useEscape(() => setPasswordModal(false), passwordModal);
  useEscape(() => setLogoutModal(false), logoutModal);
  useEffect(() => {
    if (!accountMenu) return;
    function onDown(event: MouseEvent) { if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) setAccountMenu(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [accountMenu]);
  function moveAccountFocus(event: React.KeyboardEvent, direction: "first" | "last" | "next" | "previous") {
    const items = [...(accountItemsRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = direction === "first" ? 0 : direction === "last" ? items.length - 1 : direction === "next" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }
  function accountMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") moveAccountFocus(event, "next");
    else if (event.key === "ArrowUp") moveAccountFocus(event, "previous");
    else if (event.key === "Home") moveAccountFocus(event, "first");
    else if (event.key === "End") moveAccountFocus(event, "last");
  }
  function openRoute(href: string) { navigate(href); setMobileMenu(false); }
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  return <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <DialogFocusManager />
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><RadioTower size={17} /></span><span className="brand-name">FieldTrack</span><button type="button" className="sidebar-toggle" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={sidebarCollapsed} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}><SidebarToggleIcon size={16} /></button></div>
      <div className="nav">{availableNav.map(({ href, label, icon: Icon }) => { const active = activeRoute(pathname, href); return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} aria-label={label} title={sidebarCollapsed ? label : undefined} key={href} onClick={() => openRoute(href)}><Icon size={17} /><span>{label}</span></button>; })}</div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-mark"><RadioTower size={16} /></span>FieldTrack</div>
        <div className="muted small desktop-context">Internal site registry</div>
        <div className="account-menu-wrap" ref={accountMenuRef}>
          <button type="button" className="account-trigger" aria-haspopup="menu" aria-expanded={accountMenu} onClick={() => setAccountMenu((open) => !open)} onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? "first" : "last";
            setAccountMenu(true);
            requestAnimationFrame(() => {
              const items = [...(accountItemsRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
              items[direction === "first" ? 0 : items.length - 1]?.focus();
            });
          }}>
            <span className="account-trigger-copy"><strong>{profile.fullName}</strong><small>{profile.role === "admin" ? "Administrator" : profile.role === "guest" ? "Guest" : "Staff"}</small></span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {accountMenu && <div className="account-menu" role="menu" ref={accountItemsRef} onKeyDown={accountMenuKeyDown}>
            <button type="button" role="menuitem" onClick={() => { setAccountMenu(false); setNameModal(true); }}><Pencil size={15} />Change display name</button>
            <button type="button" role="menuitem" onClick={() => { setAccountMenu(false); setPasswordModal(true); }}><KeyRound size={15} />Change password</button>
            <button type="button" className="danger" role="menuitem" onClick={() => { setAccountMenu(false); setLogoutModal(true); }}><LogOut size={15} />Log out</button>
          </div>}
        </div>
      </header>
      <div className="content">{children}</div>
    </main>
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {availableNav.slice(0, 3).map(({ href, label, icon: Icon }) => { const active = activeRoute(pathname, href); return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={href} onClick={() => openRoute(href)}><Icon size={18} /><span>{label === "Service visits" ? "Visits" : label}</span></button>; })}
      {availableNav.length > 3 && <button className={pathname === "/import" || pathname.startsWith("/admin/") ? "active" : ""} aria-expanded={mobileMenu} aria-haspopup="dialog" onClick={() => setMobileMenu(true)}><Menu size={18} /><span>More</span></button>}
    </nav>
    {mobileMenu && <div className="mobile-menu-backdrop" role="presentation" onClick={() => setMobileMenu(false)}><div className="mobile-menu-panel" role="dialog" aria-modal="true" aria-label="More navigation" onClick={(event) => event.stopPropagation()}><div className="section-title"><h2>More</h2><button type="button" className="button icon-button ghost" aria-label="Close menu" onClick={() => setMobileMenu(false)}><X size={17} /></button></div>{availableNav.slice(3).map(({ href, label, icon: Icon }) => <button type="button" className={`mobile-menu-link ${activeRoute(pathname, href) ? "active" : ""}`} aria-current={activeRoute(pathname, href) ? "page" : undefined} key={href} onClick={() => openRoute(href)}><Icon size={18} />{label}</button>)}</div></div>}
    {toast && <div className="toast" role="status" aria-live="polite" aria-atomic="true">{toast}</div>}
    {nameModal && <ChangeDisplayNameModal currentName={profile.fullName} onClose={() => setNameModal(false)} onSave={async (fullName) => { await updateOwnProfile(fullName); setProfile({ ...profile, fullName }); setNameModal(false); notify("Display name updated."); }} />}
    {passwordModal && <ChangePasswordModal onClose={() => setPasswordModal(false)} onSave={async (currentPassword, password) => { await changePassword(currentPassword, password); setPasswordModal(false); notify("Password changed."); }} />}
    {logoutModal && <ConfirmLogoutModal onClose={() => setLogoutModal(false)} onConfirm={async () => { invalidateRouteWorkspaceCache(); await signOut(); router.replace("/"); router.refresh(); }} />}
  </div>;
}
