import type { D1Database } from './billing'

export interface PlanGrant {
  plan: 'pro' | 'team'
  seats: number | null
  /** unix seconds, or null for no end date */
  until: number | null
  note: string | null
}

/** The plan an admin gave this account, if it is still running. Never throws (table may not exist yet). */
export async function activeGrant(db: D1Database | undefined, uid: string, now = Math.floor(Date.now() / 1000)): Promise<PlanGrant | null> {
  if (!db) return null
  try {
    const row = await db.prepare('SELECT plan, seats, until, note FROM plan_grants WHERE uid = ?').bind(uid).first<{ plan: string; seats: number | null; until: number | null; note: string | null }>()
    if (!row || (row.plan !== 'pro' && row.plan !== 'team')) return null
    if (row.until !== null && row.until !== undefined && row.until <= now) return null
    return { plan: row.plan, seats: row.seats ?? null, until: row.until ?? null, note: row.note ?? null }
  } catch {
    return null
  }
}
