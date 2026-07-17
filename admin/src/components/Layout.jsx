import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase/config'
import { useAuth } from '../App'
import { branchLabel } from '../lib/branch'
import BranchSwitcher from './BranchSwitcher'
import crest from '../assets/crest.png'
import banner from '../assets/banner.png'

const NAV = [
  { to:'/', label:'Dashboard', end:true, icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
  { to:'/syllabus', label:'Syllabus', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> },
  { to:'/syllabus-upload', label:'Upload Syllabus', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> },
  { to:'/lesson-plan-reschedule', label:'Reschedule', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg> },
  { to:'/lesson-plans', label:'Lesson Plans', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg> },
  { to:'/lessons', label:'Lesson Log', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> },
  { to:'/tests', label:'Tests & Marks', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
  { to:'/crosslist', label:'Marks Crosslist', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg> },
  { to:'/performance', label:'Performance', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
  { to:'/absentees', label:'Absentees', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg> },
  { to:'/arrangement', label:'Arrangement', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><line x1="23" y1="11" x2="17" y2="11"/></svg> },
  { to:'/timetable', label:'Timetable', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
  { to:'/period-settings', label:'Period Times', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  { to:'/students', label:'Students', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { to:'/attendance', label:'Attendance', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
  { to:'/teacher-management', label:'Teachers', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> },
  { to:'/admin-users', label:'Admin Users', superAdminOnly:true, icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3-3m0 0l-3 3m3-3v8"/></svg> },
  { to:'/impersonate', label:'Impersonate', superAdminOnly:true, icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> },
  { to:'/report-card-setup', label:'Session & Marks', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg> },
  { to:'/report-cards', label:'Report Cards', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg> },
  { to:'/hpc', label:'HPC Cards', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg> },
  { to:'/board-candidates', label:'Board Candidates', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12l2 2 4-4"/></svg> },
  { to:'/setup', label:'Setup', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg> },
  { to:'/classes-subjects-assignment', label:'Classes & Subjects Assignment', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
  { to:'/lesson-plan-fields', label:'Plan Fields', icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg> },
]

const SIDEBAR_W = 232

export default function Layout() {
  const { user, isSuperAdmin, currentBranch } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('rka-theme') === 'dark' } catch { return false }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    try { localStorage.setItem('rka-theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])

  async function handleLogout() { await signOut(auth); navigate('/login') }

  const currentPage = NAV.find(n => n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))

  const SidebarContent = () => (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Logo — clickable → home */}
      <div onClick={() => navigate('/')} style={{ padding:'18px 16px 14px', borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', alignItems:'center', gap:10, cursor:'pointer' }}>
        <img src={crest} alt="RKA" style={{ width:48, height:48, borderRadius:'50%', border:'1px solid rgba(201,162,39,0.4)', objectFit:'contain', background:'rgba(255,255,255,0.08)', padding:3 }} />
        <img src={banner} alt="Radhakrishna Academy" style={{ width:'100%', maxWidth:190, height:'auto', objectFit:'contain' }} />
        <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', letterSpacing:'0.12em', textTransform:'uppercase', fontFamily:'var(--font-body)' }}>Admin Portal</div>
      </div>

      {/* Branch switcher (super admin) or static badge (branch admin) */}
      <BranchSwitcher />

      {/* Nav */}
      <nav style={{ flex:1, padding:'10px 0', overflowY:'auto' }}>
        {NAV.filter(n => !n.superAdminOnly || isSuperAdmin).map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} style={({ isActive }) => ({
            display:'flex', alignItems:'center', gap:10, padding:'9px 16px',
            color: isActive ? 'var(--gold)' : 'rgba(255,255,255,0.65)',
            textDecoration:'none', fontSize:13, fontWeight:500,
            background: isActive ? 'rgba(201,162,39,0.1)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
            transition:'all 0.15s', whiteSpace:'nowrap'
          })}>
            <span style={{ flexShrink:0 }}>{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', padding:'12px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:10 }}>
          <img src={user?.photoURL || ''} alt="" style={{ width:30, height:30, borderRadius:'50%', border:'1px solid rgba(201,162,39,0.4)', flexShrink:0 }} onError={e => e.target.style.display='none'} />
          <div style={{ overflow:'hidden', flex:1 }}>
            <div style={{ fontSize:12, color:'white', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.displayName || 'Admin'}</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.email}</div>
          </div>
        </div>
        <button onClick={handleLogout} style={{ width:'100%', background:'rgba(139,26,26,0.2)', border:'none', borderRadius:6, padding:'7px', color:'rgba(255,180,180,0.8)', cursor:'pointer', fontSize:12 }}>
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <aside style={{ width:SIDEBAR_W, background:'var(--green-dark)', flexShrink:0, position:'sticky', top:0, height:'100vh', zIndex:100 }}>
          <SidebarContent />
        </aside>
      )}

      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:200 }}>
          <div onClick={() => setMobileOpen(false)} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.5)' }} />
          <aside style={{ position:'absolute', top:0, left:0, width:SIDEBAR_W, height:'100%', background:'var(--green-dark)', overflowY:'auto' }}>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div style={{ background:'var(--green-dark)', padding:'11px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:50 }}>
            <div onClick={() => navigate('/')} style={{ display:'flex', alignItems:'center', gap:9, cursor:'pointer' }}>
              <img src={crest} alt="RKA" style={{ width:30, height:30, borderRadius:'50%', border:'1px solid rgba(201,162,39,0.4)', objectFit:'contain' }} />
              <img src={banner} alt="Radhakrishna Academy" style={{ height:28, width:'auto', objectFit:'contain', maxWidth:160 }} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setDark(d => !d)} style={{ background:'rgba(255,255,255,0.1)', border:'none', borderRadius:8, padding:'8px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {dark ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
            </button>
            <button onClick={() => setMobileOpen(o => !o)} style={{ background:'rgba(255,255,255,0.1)', border:'none', borderRadius:8, padding:'8px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                {mobileOpen ? <path d="M18 6L6 18M6 6l12 12"/> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
              </svg>
            </button>
            </div>
          </div>
        )}
        {/* Desktop top bar with dark mode toggle */}
        {!isMobile && (
          <div className="topbar" style={{ background:'var(--white)', borderBottom:'1px solid var(--gray-100)', padding:'8px 24px', display:'flex', alignItems:'center', justifyContent:'flex-end', position:'sticky', top:0, zIndex:50, backdropFilter:'blur(8px)' }}>
            <button
              onClick={() => setDark(d => !d)}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className={dark ? 'gemini-border' : ''}
              style={{
                display:'flex', alignItems:'center', gap:7, padding:'6px 16px',
                borderRadius:20,
                border: dark ? 'none' : '1px solid var(--gray-200)',
                background: dark ? 'rgba(66,133,244,0.08)' : 'var(--gray-50)',
                color: dark ? '#a8c4ff' : 'var(--text-muted)',
                cursor:'pointer', fontSize:12, fontWeight:500, transition:'all 0.2s',
                position:'relative',
              }}
            >
              {dark ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8c4ff" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                  Light
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                  Dark
                </>
              )}
            </button>
          </div>
        )}
        <main style={{ flex:1, overflowY:'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
