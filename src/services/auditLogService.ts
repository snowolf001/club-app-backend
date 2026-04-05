import { PoolClient } from 'pg';
import { pool } from '../db/pool';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WriteAuditLogParams = {
  clubId: string;
  actorUserId: string;
  targetUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
};

type AuditLogRow = {
  id: string;
  action: string;
  actor_user_id: string;
  target_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AuditLogItem = {
  id: string;
  action: string;
  actorUserId: string;
  targetUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

// ─── Write (called inside transactions with a PoolClient) ─────────────────────

export async function writeAuditLog(
  client: PoolClient,
  params: WriteAuditLogParams
): Promise<void> {
  await client.query(
    `
      INSERT INTO audit_logs (
        club_id,
        actor_user_id,
        target_user_id,
        entity_type,
        entity_id,
        action,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
    `,
    [
      params.clubId,
      params.actorUserId,
      params.targetUserId ?? null,
      params.entityType ?? null,
      params.entityId ?? null,
      params.action,
      JSON.stringify(params.metadata ?? {}),
    ]
  );
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getAuditLogs(
  clubId: string,
  limit: number,
  offset: number
): Promise<AuditLogItem[]> {
  const result = await pool.query<AuditLogRow>(
    `
      SELECT
        id, action, actor_user_id, target_user_id,
        entity_type, entity_id, metadata, created_at
      FROM audit_logs
      WHERE club_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [clubId, limit, offset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}
