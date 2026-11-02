/**
 * Team plan seats: the owner (who bought the Team plan) adds and removes members by email.
 * Members get the Team plan while they hold a paid seat (see loadTeamOwnerFor in billing.ts).
 */
import { checkScanQuota, loadTeamOwnerFor, type BillingEnv } from './billing'

export interface TeamDeps {
  /** Look up an Agent Verify account by email (Firebase). Injected in tests. */
  resolveUid: (email: string) => Promise<string | null>
  now?: () => number
}

type Result = { status: number; body: unknown }

async function ownerSeats(env: BillingEnv, uid: string): Promise<number | null> {
  const quota = await checkScanQuota(env, uid)
  // Only someone whose OWN subscription is Team manages seats (a member also resolves to 'team').
  if (quota.plan !== 'team' || (await loadTeamOwnerFor(env, uid))) return null
  const row = await env.BILLING_DB!.prepare('SELECT seats FROM team_seats WHERE owner_uid = ?').bind(uid).first<{ seats: number }>()
  return row?.seats ?? null
}

async function members(env: BillingEnv, ownerUid: string) {
  return (await env.BILLING_DB!.prepare('SELECT member_uid, email, added_at FROM team_members WHERE owner_uid = ? ORDER BY added_at ASC, member_uid ASC').bind(ownerUid).all<{ member_uid: string; email: string; added_at: number }>()).results ?? []
}

/** GET /v1/team */
export async function getTeam(uid: string, env: BillingEnv): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Team plans are not available' } }
  const seats = await ownerSeats(env, uid)
  if (seats !== null) {
    const list = await members(env, uid)
    return {
      status: 200,
      body: { role: 'owner', seats, seatsUsed: Math.min(seats, list.length + 1), members: list.map((m, i) => ({ uid: m.member_uid, email: m.email, addedAt: m.added_at, active: i < seats - 1 })) },
    }
  }
  const owner = await loadTeamOwnerFor(env, uid)
  if (owner) return { status: 200, body: { role: 'member' } }
  return { status: 200, body: { role: 'none' } }
}

/** POST /v1/team/members { email } */
export async function addMember(uid: string, body: { email?: unknown }, env: BillingEnv, deps: TeamDeps): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Team plans are not available' } }
  const seats = await ownerSeats(env, uid)
  if (seats === null) return { status: 403, body: { error: 'Only the owner of an active Team plan can add members.' } }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, body: { error: 'Enter a valid email address.' } }
  const list = await members(env, uid)
  if (list.some(m => m.email === email)) return { status: 409, body: { error: 'That person is already on your team.' } }
  if (list.length + 1 >= seats) return { status: 409, body: { error: `All ${seats} seats are in use. Add seats from Manage billing, or remove a member first.` } }
  const memberUid = await deps.resolveUid(email)
  if (!memberUid) return { status: 404, body: { error: 'No Agent Verify account uses that email yet. Ask them to sign up (free), then add them again.' } }
  if (memberUid === uid) return { status: 400, body: { error: 'You already have a seat as the owner.' } }
  const now = (deps.now ?? Date.now)()
  await env.BILLING_DB.prepare('INSERT OR IGNORE INTO team_members (owner_uid, member_uid, email, added_at) VALUES (?, ?, ?, ?)').bind(uid, memberUid, email, now).run()
  return { status: 200, body: { ok: true } }
}

/** DELETE /v1/team/members?uid=... */
export async function removeMember(uid: string, memberUid: string, env: BillingEnv): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Team plans are not available' } }
  if ((await ownerSeats(env, uid)) === null) return { status: 403, body: { error: 'Only the Team owner can remove members.' } }
  if (!memberUid) return { status: 400, body: { error: 'uid is required' } }
  await env.BILLING_DB.prepare('DELETE FROM team_members WHERE owner_uid = ? AND member_uid = ?').bind(uid, memberUid).run()
  return { status: 200, body: { ok: true } }
}
