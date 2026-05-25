import React, { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase/config'
import { useAuth } from '../App'
import crest from '../assets/crest.png'
import banner from '../assets/banner.png'

const NAV = [
  { to:'/', label:'Home', end:true, icon:(active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active?'var(--green)':'none'} stroke={active?'var(--green)':'var(--gray-400)'} strokeWidth="1.8">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )},
  { to:'/log-lesson', label:'Lessons', icon:(active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active?'var(--green)':'var(--gray-400)'} strokeWidth="1.8">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )},
  { to:'/enter-marks', label:'Marks', icon:(active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active?'var(--green)':'var(--gray-400)'} strokeWidth="1.8">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  )},
  { to:'/lesson-plan', label:'Plan', icon:(active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active?'var(--green)':'var(--gray-400)'} strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/>
    </svg>
  )},
  { to:'/student-analytics', label:'Students', icon:(active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active?'var(--green)':'var(--gray-400)'} strokeWidth="1.8">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )},
  { to:'/my-marks', label:'Results', icon:(active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active?'var(--green)':'var(--gray-400)'} strokeWidth="1.8">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )},
  { to:'/my-syllabus', label:'Syllabus', icon:(active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active?'var(--green)':'var(--gray-400)'} strokeWidth="1.8">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  )},
]

export default function Layout() {
  const { teacher, user } = useAuth()
  const navigate = useNavigate()
  const [showProfileMenu, setShowProfileMenu] = useState(false)

  async function handleSignOut() {
    setShowProfileMenu(false)
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', maxWidth:480, margin:'0 auto' }}>
      {/* Top bar */}
      <header style={{ background:'var(--green-dark)', padding:'14px 20px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <img src={crest} alt="RKA" style={{ width:32, height:32, borderRadius:'50%', border:'1px solid rgba(201,162,39,0.4)', objectFit:'contain', background:'rgba(201,162,39,0.1)', padding:2, flexShrink:0 }} />
          <img src={banner} alt="Radhakrishna Academy" style={{ height:28, width:'auto', maxWidth:170, objectFit:'contain', mixBlendMode:'screen' }} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.85)', fontWeight:500 }}>{teacher?.fullName || user?.displayName || 'Teacher'}</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>{(teacher?.subjectsTaught||[]).slice(0,2).join(', ')}</div>
          </div>
          {/* Profile avatar — tap to show sign out */}
          <div style={{ position:'relative' }}>
            <div
              onClick={() => setShowProfileMenu(m => !m)}
              style={{ cursor:'pointer', position:'relative' }}
            >
              {user?.photoURL
                ? <img src={user.photoURL} alt="" style={{ width:36, height:36, borderRadius:'50%', border:'2px solid rgba(201,162,39,0.5)', display:'block' }} />
                : <div style={{ width:36, height:36, borderRadius:'50%', background:'rgba(201,162,39,0.2)', border:'2px solid rgba(201,162,39,0.5)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <span style={{ fontSize:13, fontWeight:700, color:'var(--gold)' }}>{(teacher?.fullName||user?.displayName||'T').charAt(0)}</span>
                  </div>
              }
              {/* Small chevron indicator */}
              <div style={{ position:'absolute', bottom:-2, right:-2, width:14, height:14, borderRadius:'50%', background:'var(--green-dark)', border:'1px solid rgba(201,162,39,0.4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            </div>

            {/* Dropdown menu */}
            {showProfileMenu && (
              <>
                {/* Backdrop */}
                <div onClick={() => setShowProfileMenu(false)} style={{ position:'fixed', inset:0, zIndex:98 }} />
                <div style={{ position:'absolute', top:'calc(100% + 10px)', right:0, background:'var(--white)', borderRadius:'var(--radius-md)', boxShadow:'0 8px 32px rgba(0,0,0,0.18)', border:'1px solid var(--gray-100)', minWidth:200, zIndex:99, overflow:'hidden' }}>
                  {/* User info header */}
                  <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--gray-100)', background:'var(--gray-50)' }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{teacher?.fullName || user?.displayName}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{user?.email}</div>
                    {teacher?.subjectsTaught?.length > 0 && (
                      <div style={{ fontSize:11, color:'var(--green)', marginTop:4 }}>{teacher.subjectsTaught.join(', ')}</div>
                    )}
                  </div>
                  {/* Sign out button */}
                  <button
                    onClick={handleSignOut}
                    style={{ width:'100%', padding:'12px 16px', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:10, color:'var(--crimson)', fontSize:13, fontWeight:500, textAlign:'left' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16 17 21 12 16 7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Page content */}
      <main style={{ flex:1, overflowY:'auto', paddingBottom:`calc(72px + var(--safe-bottom))` }}>
        <Outlet />
      </main>

      {/* Bottom navigation */}
      <nav style={{ position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:480, background:'var(--white)', borderTop:'1px solid var(--gray-100)', display:'flex', paddingBottom:'var(--safe-bottom)', zIndex:50, boxShadow:'0 -4px 20px rgba(0,0,0,0.08)' }}>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} style={({ isActive }) => ({
            flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            padding:'10px 4px 8px', gap:3, textDecoration:'none',
            color: isActive ? 'var(--green)' : 'var(--gray-400)',
            position:'relative'
          })}>
            {({ isActive }) => (<>
              {isActive && <div style={{ position:'absolute', top:0, left:'25%', right:'25%', height:2, background:'var(--green)', borderRadius:'0 0 2px 2px' }} />}
              {n.icon(isActive)}
              <span style={{ fontSize:10, fontWeight: isActive ? 600 : 400 }}>{n.label}</span>
            </>)}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
