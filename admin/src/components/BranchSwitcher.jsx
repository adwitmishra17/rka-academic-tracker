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
// Visual: light card with house-green accent on selection, matching
// the House Colours sidebar.
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
        background: 'var(--green-light)',
        border: '1px solid var(--green-muted)',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.8">
          <path d="M3 21v-7l9-7 9 7v7"/>
          <path d="M9 21v-9h6v9"/>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 1 }}>
            Branch
          </div>
          <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
          background: open ? 'var(--green-light)' : 'var(--gray-50)',
          border: '1px solid',
          borderColor: open ? 'var(--green-muted)' : 'var(--gray-200)',
          borderRadius: 10,
          color: 'var(--text)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isAll ? 'var(--green)' : 'var(--text-muted)'} strokeWidth="1.8" style={{ flexShrink: 0 }}>
          <path d="M3 21v-7l9-7 9 7v7"/>
          <path d="M9 21v-9h6v9"/>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 1 }}>
            Branch
          </div>
          <div style={{
            fontSize: 12,
            color: isAll ? 'var(--green)' : 'var(--text)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {currentLabel}
          </div>
        </div>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2.5" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-lg)',
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
          <div style={{ height: 1, background: 'var(--gray-100)' }} />
          {BRANCHES.map((b, idx) => (
            <React.Fragment key={b.code}>
              <Option
                label={b.label}
                sub={b.sub}
                isActive={currentBranch === b.code}
                onClick={() => { setCurrentBranch(b.code); setOpen(false) }}
              />
              {idx < BRANCHES.length - 1 && (
                <div style={{ height: 1, background: 'var(--gray-100)' }} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function Option({ label, sub, isActive, isAll, onClick }) {
  const accent = isAll ? 'var(--green)' : 'var(--green)'
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '10px 12px',
        background: isActive ? 'var(--green-light)' : 'transparent',
        border: 'none',
        borderLeft: isActive ? `2px solid ${accent}` : '2px solid transparent',
        color: 'var(--text)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--gray-50)' }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          color: isActive ? accent : 'var(--text)',
          fontWeight: isActive ? 600 : 500,
          marginBottom: 1,
        }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
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
