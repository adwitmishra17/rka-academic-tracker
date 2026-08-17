'use strict'
// =============================================================================
// functions/socialAccessSync.js — admins → RKA Social access sync
//
// HRMS grants social media access by writing moduleRoles.social on a doc in the
// shared `admins` collection. RKA Social runs on Hostinger with its own MariaDB
// and needs to know about that grant.
//
// WHY A CLOUD FUNCTION AND NOT A DIRECT CALL FROM HRMS
// ----------------------------------------------------
// The obvious approach — HRMS POSTs to the Social API with a shared secret —
// is not safe. HRMS is a browser app, so anything in its bundle is readable by
// anyone who loads the page, signed in or not. A leaked SOCIAL_SYNC_SECRET
// would let a stranger grant themselves permission to post publicly as the
// school. The secret has to stay server-side, so the relay lives here.
//
// A Firestore trigger is also strictly better than an explicit call: it fires
// on EVERY path that changes a grant — the admin form, a direct console edit,
// a deletion, a deactivation — so there is no way to change access and forget
// to sync it.
//
// ─── CRITICAL RULES ─────────────────────────────────────────────────────────
//   1. Absence of a grant means REVOKE, never "leave alone". A deleted admin
//      doc, isActive=false, or moduleRoles.social=null all withdraw access.
//      Getting this backwards would leave a leaver able to post as the school.
//
//   2. Failures here must be loud. If the relay is down, the daily reconcile
//      is the backstop — but a silent failure with no reconcile means a
//      revocation that never happened.
//
// Deploy:
//   firebase functions:secrets:set SOCIAL_SYNC_SECRET
//   firebase functions:secrets:set SOCIAL_API_BASE     # e.g. https://social.rkacademyballia.in
//   firebase deploy --only functions:syncSocialAccess,functions:reconcileSocialAccess
// =============================================================================

const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onSchedule }        = require('firebase-functions/v2/scheduler')
const { defineSecret }      = require('firebase-functions/params')
const admin                 = require('firebase-admin')

if (!admin.apps.length) admin.initializeApp()

const SOCIAL_SYNC_SECRET = defineSecret('SOCIAL_SYNC_SECRET')
const SOCIAL_API_BASE    = defineSecret('SOCIAL_API_BASE')

const VALID_SOCIAL_ROLES = ['admin', 'approver', 'author']

/**
 * Read the social level off an admin doc.
 *
 * Deliberately strict: only an explicit, recognised value in
 * moduleRoles.social counts. Legacy docs that predate the social module have
 * no such field and must resolve to null — inferring access from the legacy
 * `modules` array would silently hand every existing admin the ability to
 * post publicly.
 */
function socialRoleOf (doc) {
  if (!doc) return null
  if (doc.isActive === false) return null
  const level = doc.moduleRoles && doc.moduleRoles.social
  return VALID_SOCIAL_ROLES.includes(level) ? level : null
}

/**
 * Read the phone off an admin doc.
 *
 * Older docs carry a capital-P `Phone` field; admins.js still reads it as a
 * fallback and clears it on edit. Missing it here would send phone: null for
 * a legacy PHONE-ONLY admin, which reads as "revoke" on the Social side and
 * would quietly lock them out.
 */
function phoneOf (doc) {
  if (!doc) return null
  return doc.phone || doc.Phone || null
}

async function pushToSocial (path, body, apiBase, secret) {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/sync/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RKA-Secret': secret,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`social sync ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  return text
}

// -----------------------------------------------------------------------------
// Per-document trigger
// -----------------------------------------------------------------------------
exports.syncSocialAccess = onDocumentWritten(
  { document: 'admins/{adminId}', secrets: [SOCIAL_SYNC_SECRET, SOCIAL_API_BASE] },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null
    const after  = event.data?.after?.exists ? event.data.after.data() : null
    const adminDocId = event.params.adminId

    const wasRole = socialRoleOf(before)
    const nowRole = socialRoleOf(after)

    // Identity can change too (an email added to a phone-only admin), so
    // compare those as well rather than only the role.
    const idChanged =
      (before?.email || null) !== (after?.email || null) ||
      phoneOf(before) !== phoneOf(after) ||
      (before?.fullName || '') !== (after?.fullName || '')

    if (wasRole === nowRole && !idChanged) return   // nothing relevant changed

    const payload = {
      adminDocId,
      // On delete there is no `after`; fall back to the previous identity so
      // the Social side can still find and revoke the right row.
      email:      (after?.email ?? before?.email) || null,
      phone:      phoneOf(after) ?? phoneOf(before),
      fullName:   (after?.fullName ?? before?.fullName) || '',
      socialRole: nowRole,
      isActive:   nowRole !== null,
    }

    await pushToSocial('user', payload, SOCIAL_API_BASE.value(), SOCIAL_SYNC_SECRET.value())
    console.log(
      `syncSocialAccess: ${payload.email || payload.phone} ${wasRole || 'none'} → ${nowRole || 'none'}`,
    )
  },
)

// -----------------------------------------------------------------------------
// Daily reconcile — the backstop.
//
// If a trigger ever fails (Social API down during a deploy, a transient
// network error), a revocation could be lost. This resends the full picture
// once a day; the Social side deactivates anyone not in the list.
// -----------------------------------------------------------------------------
exports.reconcileSocialAccess = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'Asia/Kolkata',
    secrets: [SOCIAL_SYNC_SECRET, SOCIAL_API_BASE],
  },
  async () => {
    const snap = await admin.firestore().collection('admins').get()

    const users = []
    for (const d of snap.docs) {
      const data = d.data()
      const role = socialRoleOf(data)
      if (!role) continue
      users.push({
        adminDocId: d.id,
        email: data.email || null,
        phone: phoneOf(data),
        fullName: data.fullName || '',
        socialRole: role,
        isActive: true,
      })
    }

    const result = await pushToSocial(
      'reconcile', { users }, SOCIAL_API_BASE.value(), SOCIAL_SYNC_SECRET.value(),
    )
    console.log(`reconcileSocialAccess: sent ${users.length} grants → ${result}`)
  },
)
