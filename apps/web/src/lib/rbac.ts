/**
 * UI-only mirror of the authoritative RBAC permission matrix.
 *
 * This is NEVER the real enforcement — it only decides which buttons/actions to SHOW. The actual
 * authority is workers/api/src/rbac.ts, checked server-side on every request via
 * workers/api/src/authz.ts. If this file drifts out of sync with the server matrix, the worst
 * case is a button that's shown but then correctly rejected server-side (annoying, not unsafe) —
 * never the other way around, since nothing here can grant an action the server wouldn't already
 * allow. Keep the two matrices in sync by hand; there is deliberately no shared package between
 * the Worker and the web app for this (see the server file's own comment on why).
 */

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'

export type Permission =
  | 'view_agent'
  | 'start_scan'
  | 'view_report'
  | 'share_report'
  | 'revoke_share'
  | 'view_api_keys'
  | 'create_api_key'
  | 'rotate_api_key'
  | 'view_policies'
  | 'modify_policies'
  | 'view_members'
  | 'invite_members'
  | 'modify_roles'
  | 'view_audit_log'
  | 'configure_integrations'
  | 'configure_webhook'
  | 'billing_access'
  | 'delete_organization'

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [
    'view_agent', 'start_scan', 'view_report', 'share_report', 'revoke_share',
    'view_api_keys', 'create_api_key', 'rotate_api_key',
    'view_policies', 'modify_policies',
    'view_members', 'invite_members', 'modify_roles',
    'view_audit_log',
    'configure_integrations', 'configure_webhook',
    'billing_access', 'delete_organization',
  ],
  ADMIN: [
    'view_agent', 'start_scan', 'view_report', 'share_report', 'revoke_share',
    'view_api_keys', 'create_api_key', 'rotate_api_key',
    'view_policies', 'modify_policies',
    'view_members', 'invite_members',
    'view_audit_log',
    'configure_integrations', 'configure_webhook',
  ],
  MEMBER: [
    'view_agent', 'start_scan', 'view_report', 'share_report', 'revoke_share',
    'view_api_keys', 'create_api_key', 'rotate_api_key',
    'view_policies',
    'view_members',
    'view_audit_log',
  ],
  VIEWER: [
    'view_agent', 'view_report', 'view_policies', 'view_members', 'view_audit_log',
  ],
}

export function hasPermission(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Full workspace control, including billing and deleting the workspace.',
  ADMIN: 'Operational control — members, policies, integrations, webhooks — without owner-only actions.',
  MEMBER: 'Can scan agents, view reports, share/revoke reports, and manage their own API key.',
  VIEWER: 'Read-only access to agents, reports, policies, members, and the audit log.',
}
