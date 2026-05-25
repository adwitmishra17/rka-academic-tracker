import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../App'
import { BRANCHES, branchLabel } from '../lib/branch'

// ============================================================================
// BRANCH SWITCHER (sidebar variant)
//
// Lives in the tracker's dark sidebar between the logo and nav links.
// Two modes:
//
//   Super admin (multi-branch access):
//     Dropdown with three options — All Branches, Main Campus, City Branch.
//     Click outside to dismiss.
//
//   Branch admin (single-branch access):
//     Static read-only badge showing their branch. No dropdown.
//
// Visual: dark with gold accent on selection, matching the sidebar's
// existing nav-link active state.
// ============================================================================

export default function BranchSwitcher() {
  const { allowedBranches, currentBranch, setCurrentBranch, canSwitchBranches } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Click-outside-to-close
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Branch-locked admin → static badge
  if (!canSwitchBranches) {
    if (allowedBranches.length === 0) return null
    const code = allowedBranches[0]
    return (
      <div style={{
        margin: '8px 12px',
        padding: '8px 12px',
        background: 'rgba(201,162,39,0.08)',
        border: '1px solid rgba(201,162,39,0.25)',
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a227)" strokeWidth="1.8">
          <path d="M3 21v-7l9-7 9 7v7"/>
          <path d="M9 21v-9h6v9"/>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 1 }}>
            Branch
          </div>
          <div style={{ fontSize: 12, color: 'var(--gold, #c9a227)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {branchLabel(code)}
          </div>
        </div>
      </div>
    )
  }

  // Super admin → dropdown
  const currentLabel = branchLabel(currentBranch)
  const isAll = currentBranch === null

  return (
    <div ref={ref} style={{ margin: '8px 12px', position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: open ? 'rgba(201,162,39,0.12)' : 'rgba(255,255,255,0.04)',
          border: '1px solid',
          borderColor: open ? 'rgba(201,162,39,0.4)' : 'rgba(255,255,255,0.1)',
          borderRadius: 6,
          color: 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isAll ? 'var(--gold, #c9a227)' : 'rgba(255,255,255,0.7)'} strokeWidth="1.8" style={{ flexShrink: 0 }}>
          <path d="M3 21v-7l9-7 9 7v7"/>
          <path d="M9 21v-9h6v9"/>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 1 }}>
            Branch
          </div>
          <div style={{
            fontSize: 12,
            color: isAll ? 'var(--gold, #c9a227)' : 'white',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {currentLabel}
          </div>
        </div>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          background: 'rgba(20,40,30,0.98)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 200,
          overflow: 'hidden',
          backdropFilter: 'blur(6px)',
        }}>
          <Option
            label="All Branches"
            sub="View across both campuses"
            isActive={currentBranch === null}
            isAll
            onClick={() => { setCurrentBranch(null); setOpen(false) }}
          />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />
          {BRANCHES.map((b, idx) => (
            <React.Fragment key={b.code}>
              <Option
                label={b.label}
                sub={b.sub}
                isActive={currentBranch === b.code}
                onClick={() => { setCurrentBranch(b.code); setOpen(false) }}
              />
              {idx < BRANCHES.length - 1 && (
                <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function Option({ label, sub, isActive, isAll, onClick }) {
  const accent = isAll ? 'var(--gold, #c9a227)' : 'var(--gold, #c9a227)'
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '10px 12px',
        background: isActive ? 'rgba(201,162,39,0.1)' : 'transparent',
        border: 'none',
        borderLeft: isActive ? `2px solid ${accent}` : '2px solid transparent',
        color: 'white',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          color: isActive ? accent : 'white',
          fontWeight: isActive ? 600 : 500,
          marginBottom: 1,
        }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
          {sub}
        </div>
      </div>
      {isActive && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </button>
  )
}
