import React from 'react'
import { useAuth } from '../App'
import { BRANCHES, branchLabel } from '../lib/branch'

// ============================================================================
// BRANCH SWITCHER (sidebar segmented control)
//
// Super admin: three-way segment — Main · City · Both. One click, no menu.
// Branch admin: static badge with their branch. Sits directly under the
// logo so the partition key is always visible.
// ============================================================================

const SHORT = { MAIN: 'Main', CITY: 'City' }

export default function BranchSwitcher() {
  const { allowedBranches, currentBranch, setCurrentBranch, canSwitchBranches } = useAuth()

  if (!canSwitchBranches) {
    if (allowedBranches.length === 0) return null
    const code = allowedBranches[0]
    return (
      <div style={{ margin: '4px 12px 10px', padding: '7px 12px', background: 'var(--green-light)', border: '1px solid var(--green-muted)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.8"><path d="M3 21v-7l9-7 9 7v7"/><path d="M9 21v-9h6v9"/></svg>
        <span style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{branchLabel(code)}</span>
      </div>
    )
  }

  const options = [
    ...BRANCHES.filter(b => allowedBranches.includes(b.code)).map(b => ({ key: b.code, label: SHORT[b.code] || b.label, title: b.label })),
    { key: null, label: 'Both', title: 'All branches' },
  ]

  return (
    <div role="radiogroup" aria-label="Branch" style={{ margin: '4px 12px 10px', display: 'flex', background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map(o => {
        const active = currentBranch === o.key
        return (
          <button key={String(o.key)} role="radio" aria-checked={active} title={o.title} onClick={() => setCurrentBranch(o.key)} style={{
            flex: 1, padding: '6px 0', fontSize: 12, fontWeight: active ? 600 : 500, fontFamily: 'inherit', cursor: 'pointer',
            background: active ? 'var(--text)' : 'transparent', color: active ? 'var(--white)' : 'var(--text-muted)',
            border: 'none', borderRadius: 8, transition: 'all 0.15s',
          }}>{o.label}</button>
        )
      })}
    </div>
  )
}
