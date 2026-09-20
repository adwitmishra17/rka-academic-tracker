import React, { useState, useEffect, useMemo } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import SkolixLockup from './SkolixLockup'
import { auth } from '../firebase/config'
import { useAuth } from '../App'
import { examApi } from '../lib/api'
import BranchSwitcher from './BranchSwitcher'
import CommandPalette from './CommandPalette'
import crest from '../assets/crest.png'
import banner from '../assets/banner.png'
import bannerLight from '../assets/banner-light.png'

// ============================================================================
// LAYOUT — the shared shell (Direction A, "Command centre", Sep 2026)
//
//   • Sidebar: crest + branch segment, then the nav in FIVE groups instead of
//     one flat list. Groups collapse (persisted per browser).
//   • Header: ⌘K search (pages · students · teachers), session pill,
//     theme toggle.
//   • Same mobile drawer, new-build detector and dark mode as before.
// ============================================================================

const ICONS = {
  '/': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  '/syllabus': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  '/syllabus-pdf': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h6M9 9h1"/></svg>,
  '/lesson-plan-reschedule': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>,
  '/lesson-plans': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>,
  '/lessons': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  '/homework': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="17" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/></svg>,
  '/tests': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  '/performance': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  '/absentees': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
  '/arrangement': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
  '/timetable': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  '/period-settings': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  '/non-working-days': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="10" y1="15" x2="14" y2="19"/><line x1="14" y1="15" x2="10" y2="19"/></svg>,
  '/students': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  '/attendance': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  '/teacher-management': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>,
  '/impersonate': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  '/examinations': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>,
  '/hpc': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>,
  '/board-candidates': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12l2 2 4-4"/></svg>,
  '/setup': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>,
  '/classes-subjects-assignment': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  '/lesson-plan-fields': <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>,
}

const NAV_GROUPS = [
  { key: 'home', items: [{ to: '/', label: 'Dashboard', end: true }] },
  { key: 'teaching', label: 'Teaching', items: [
    { to: '/syllabus', label: 'Syllabus' },
    { to: '/syllabus-pdf', label: 'Syllabus PDF' },
    { to: '/lesson-plans', label: 'Lesson plans' },
    { to: '/lesson-plan-reschedule', label: 'Reschedule plans' },
    { to: '/lessons', label: 'Lesson log' },
    { to: '/homework', label: 'Homework' },
    { to: '/arrangement', label: 'Arrangement' },
  ] },
  { key: 'assessment', label: 'Assessment', items: [
    { to: '/tests', label: 'Tests & marks' },
    { to: '/performance', label: 'Performance' },
    { to: '/examinations', label: 'Examinations' },
    { to: '/hpc', label: 'HPC cards' },
    { to: '/board-candidates', label: 'Board candidates' },
    { to: '/senior-subjects', label: 'Senior subjects' },
  ] },
  { key: 'people', label: 'People', items: [
    { to: '/students', label: 'Students' },
    { to: '/attendance', label: 'Attendance' },
    { to: '/absentees', label: 'Absentees' },
    { to: '/teacher-management', label: 'Teachers' },
  ] },
  { key: 'setup', label: 'Schedule & setup', items: [
    { to: '/timetable', label: 'Timetable' },
    { to: '/period-settings', label: 'Period times' },
    { to: '/non-working-days', label: 'Non-working days' },
    { to: '/setup', label: 'Setup' },
    { to: '/classes-subjects-assignment', label: 'Classes & subjects' },
    { to: '/lesson-plan-fields', label: 'Plan fields' },
    { to: '/impersonate', label: 'Impersonate', superAdminOnly: true },
  ] },
]

const SIDEBAR_W = 236
const LS_COLLAPSED = 'rka-tracker-nav-collapsed'

function readCollapsed() { try { return JSON.parse(localStorage.getItem(LS_COLLAPSED) || '{}') } catch { return {} } }

const Kbd = ({ children }) => <span style={{ fontSize: 11, fontWeight: 600, border: '1px solid var(--gray-200)', borderRadius: 5, padding: '1px 6px', background: 'var(--white)', color: 'var(--text-muted)' }}>{children}</span>

export default function Layout() {
  const { user, isSuperAdmin, adminRole } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [session, setSession] = useState('')

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // ⌘K / Ctrl+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Active session (SMS sessions.is_current) for the header pill.
  useEffect(() => {
    examApi.sessions().then(r => setSession(r?.current || '')).catch(() => {})
  }, [])

  useEffect(() => { try { localStorage.setItem(LS_COLLAPSED, JSON.stringify(collapsed)) } catch {} }, [collapsed])

  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('rka-theme') === 'dark' } catch { return false }
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    try { localStorage.setItem('rka-theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])

  async function handleLogout() { await signOut(auth); navigate('/login') }

  // New-build detector: Hostinger swaps the bundle on every push, but a tab
  // that stays open keeps running the old JS. Poll index.html and compare the
  // hashed bundle name; offer a reload when it changes.
  const [newBuild, setNewBuild] = useState(false)
  useEffect(() => {
    const current = [...document.scripts].map((s) => s.src).find((src) => /\/assets\/index-[\w-]+\.js/.test(src))
    if (!current) return
    const mine = current.match(/index-([\w-]+)\.js/)?.[1]
    const check = async () => {
      try {
        const html = await (await fetch('/?v=' + Date.now(), { cache: 'no-store' })).text()
        const live = html.match(/assets\/index-([\w-]+)\.js/)?.[1]
        if (live && mine && live !== mine) setNewBuild(true)
      } catch { /* offline — ignore */ }
    }
    const id = setInterval(check, 3 * 60 * 1000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus) }
  }, [])

  const groups = useMemo(() => NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(n => !n.superAdminOnly || isSuperAdmin) })), [isSuperAdmin])
  const pages = useMemo(() => groups.flatMap(g => g.items.map(n => ({ ...n, group: g.label || 'Home' }))), [groups])
  const isActivePath = (n) => n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)

  const initials = (user?.displayName || user?.email || 'A').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
  const roleLabel = isSuperAdmin ? 'Super admin' : (adminRole ? adminRole.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : 'Admin')

  const SidebarContent = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div onClick={() => navigate('/')} style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <img src={crest} alt="RKA" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--gray-200)', objectFit: 'contain', background: 'var(--gray-50)', padding: 2, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <img src={dark ? banner : bannerLight} alt="Radhakrishna Academy" style={{ width: '100%', maxWidth: 150, height: 'auto', objectFit: 'contain', display: 'block' }} />
          <div style={{ marginTop: 4, color: 'var(--text)' }}><SkolixLockup app="Academics" color="#7C3AED" height={13} /></div>
        </div>
      </div>

      <BranchSwitcher />

      <nav style={{ flex: 1, padding: '0 12px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map(g => {
          const groupActive = g.items.some(isActivePath)
          const isCollapsed = !!collapsed[g.key] && !groupActive
          return (
            <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {g.label && (
                <button onClick={() => setCollapsed(c => ({ ...c, [g.key]: !c[g.key] }))} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 4px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 600, color: 'var(--gray-400)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  <span>{g.label}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              )}
              {!isCollapsed && g.items.map(n => (
                <NavLink key={n.to} to={n.to} end={n.end} style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                  color: isActive ? 'var(--green-dark)' : 'var(--gray-800)',
                  textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 500,
                  background: isActive ? 'var(--green-light)' : 'transparent',
                  borderRadius: 8, transition: 'background 0.12s', whiteSpace: 'nowrap',
                })}>
                  <span style={{ flexShrink: 0, display: 'flex', width: 16, height: 16 }}>{ICONS[n.to]}</span>
                  <span>{n.label}</span>
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>

      <div style={{ borderTop: '1px solid var(--gray-100)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        {user?.photoURL
          ? <img src={user.photoURL} alt="" style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--gray-200)', flexShrink: 0 }} onError={e => { e.target.style.display = 'none' }} />
          : <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--green-light)', color: 'var(--green-dark)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{initials}</span>}
        <div style={{ overflow: 'hidden', flex: 1 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.displayName || 'Admin'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roleLabel}</div>
        </div>
        <button onClick={handleLogout} title="Sign out" style={{ background: 'none', border: '1px solid var(--gray-100)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </div>
  )

  const ThemeButton = ({ compact }) => (
    <button onClick={() => setDark(d => !d)} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--gray-100)', background: 'var(--white)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {dark
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
    </button>
  )

  const SearchTrigger = ({ grow }) => (
    <button onClick={() => setPaletteOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: grow ? '100%' : 420, maxWidth: '100%', height: 36, background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 10, padding: '0 12px', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit', cursor: 'text', textAlign: 'left' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Search students, teachers, pages…</span>
      {!grow && <Kbd>⌘K</Kbd>}
    </button>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {!isMobile && (
        <aside style={{ width: SIDEBAR_W, background: 'var(--white)', borderRight: '1px solid var(--gray-100)', flexShrink: 0, position: 'sticky', top: 0, height: '100vh', zIndex: 100 }}>
          <SidebarContent />
        </aside>
      )}

      {isMobile && mobileOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200 }}>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <aside style={{ position: 'absolute', top: 0, left: 0, width: SIDEBAR_W, height: '100%', background: 'var(--white)', borderRight: '1px solid var(--gray-100)', overflowY: 'auto' }}>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {isMobile ? (
          <div className="topbar" style={{ background: 'var(--white)', borderBottom: '1px solid var(--gray-100)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 50 }}>
            <button onClick={() => setMobileOpen(o => !o)} aria-label="Menu" style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--gray-100)', background: 'var(--white)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {mobileOpen ? <path d="M18 6L6 18M6 6l12 12"/> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
              </svg>
            </button>
            <img src={crest} alt="RKA" onClick={() => navigate('/')} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--gray-200)', objectFit: 'contain', cursor: 'pointer', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}><SearchTrigger grow /></div>
            <ThemeButton />
          </div>
        ) : (
          <div className="topbar" style={{ background: 'var(--white)', borderBottom: '1px solid var(--gray-100)', height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 50 }}>
            <SearchTrigger />
            <div style={{ flex: 1 }} />
            {session && (
              <div title="Active session (from SMS)" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 500, color: 'var(--gray-800)', background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 99, padding: '6px 12px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                Session {session}
              </div>
            )}
            <ThemeButton />
          </div>
        )}

        {newBuild && (
          <div style={{ position: 'sticky', top: isMobile ? 61 : 56, zIndex: 60, background: 'var(--gold-light)', borderBottom: '1px solid rgba(201,162,39,0.4)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, color: 'var(--gold-dark)' }}>
            <span style={{ flex: 1 }}><b>A newer version of the Tracker is live.</b> Reload to get the latest screens — unsaved edits on this page will be lost.</span>
            <button onClick={() => window.location.reload()} style={{ padding: '6px 14px', background: 'var(--gold-dark)', color: 'white', border: 'none', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Reload now</button>
          </div>
        )}

        <main style={{ flex: 1, overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} pages={pages} />
    </div>
  )
}
