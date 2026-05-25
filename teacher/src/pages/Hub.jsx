import React from 'react'
import { Link } from 'react-router-dom'

// =============================================================================
// Hub.jsx
//
// /hrms — entry page for HR/payroll-related teacher self-service.
// Reachable from the gold "My HRMS data" tile on Home; not in the bottom nav.
//
// Add new items by appending to HUB_ITEMS. enabled:false renders as a greyed
// "Soon" card with no link target — flip to enabled:true and point `to` at the
// new route once the feature ships.
// =============================================================================

const HUB_ITEMS = [
  {
    id: 'attendance',
    title: 'My attendance',
    subtitle: 'Today + last 30 days',
    to: '/hrms/attendance',
    enabled: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
  {
    id: 'documents',
    title: 'My documents',
    subtitle: 'Employment records',
    to: '/hrms/documents',
    enabled: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
        <line x1="9" y1="17" x2="15" y2="17"/>
      </svg>
    ),
  },
  {
    id: 'payslips',
    title: 'Payslips',
    subtitle: 'Monthly salary slips',
    to: null,
    enabled: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
  {
    id: 'leave',
    title: 'Leave',
    subtitle: 'Apply and track balance',
    to: null,
    enabled: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
]

export default function Hub() {
  return (
    <div style={{ padding:'24px 20px' }}>
      {/* Back to home */}
      <Link
        to="/"
        style={{
          display:'inline-flex', alignItems:'center', gap:6,
          color:'var(--text-muted)', textDecoration:'none',
          fontSize:13, fontWeight:500, marginBottom:18,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back to home
      </Link>

      {/* Title + gold underline (matches admin page-header treatment) */}
      <h1 style={{
        fontFamily:'var(--font-display)', fontSize:22, fontWeight:600,
        color:'var(--green-dark)', marginBottom:2, lineHeight:1.3,
      }}>
        My HRMS data
      </h1>
      <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>
        Personal records and history
      </p>
      <div style={{
        width:36, height:2,
        background:'linear-gradient(90deg, var(--gold), transparent)',
        marginBottom:22, borderRadius:1,
      }} />

      {/* 2x2 card grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        {HUB_ITEMS.map(item => {
          const cardStyle = {
            background: item.enabled ? 'var(--white)' : 'var(--gray-50)',
            border: '1px solid var(--gray-100)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 14px',
            opacity: item.enabled ? 1 : 0.7,
            cursor: item.enabled ? 'pointer' : 'default',
            textDecoration: 'none',
            display: 'block',
            color: 'inherit',
            minHeight: 130,
          }
          const inner = (
            <>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: item.enabled ? 'var(--green-light)' : 'var(--gray-100)',
                color: item.enabled ? 'var(--green)' : 'var(--gray-400)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 12,
              }}>
                {item.icon}
              </div>
              <div style={{
                fontSize:13, fontWeight:600,
                color: item.enabled ? 'var(--text)' : 'var(--text-muted)',
                marginBottom: 2,
              }}>
                {item.title}
              </div>
              <div style={{
                fontSize:11,
                color: item.enabled ? 'var(--text-muted)' : 'var(--gray-400)',
                lineHeight:1.4,
              }}>
                {item.subtitle}
              </div>
              {!item.enabled && (
                <span style={{
                  display:'inline-block',
                  fontSize:9.5, background:'var(--gray-100)', color:'var(--text-muted)',
                  padding:'2px 7px', borderRadius:6, marginTop:8,
                  letterSpacing:'0.05em', textTransform:'uppercase', fontWeight:600,
                }}>
                  Soon
                </span>
              )}
            </>
          )
          return item.enabled ? (
            <Link key={item.id} to={item.to} style={cardStyle}>{inner}</Link>
          ) : (
            <div key={item.id} style={cardStyle}>{inner}</div>
          )
        })}
      </div>
    </div>
  )
}
