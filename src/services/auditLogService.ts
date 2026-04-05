import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WriteAuditLogParams = {
  clubId: string;
  actorUserId: string;
  targetUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sessionId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
};

type AuditLogRow = {
  id: string;
  action: string;
  actor_user_id: string;
  actor_name: string | null;
  target_user_id: string | null;
  target_user_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  session_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AuditLogItem = {
  id: string;
  action: string;
  actorUserId: string;
  actorName: string | null;
  targetUserId: string | null;
  targetUserName: string | null;
  entityType: string | null;
  entityId: string | null;
  sessionId: string | null;
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
        session_id,
        action,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
    `,
    [
      params.clubId,
      params.actorUserId,
      params.targetUserId ?? null,
      params.entityType ?? null,
      params.entityId ?? null,
      params.sessionId ?? null,
      params.action,
      JSON.stringify(params.metadata ?? {}),
    ]
  );
}

// ─── Write (standalone — safe fire-and-forget for non-transactional callers) ──

export async function createAuditLog(
  params: WriteAuditLogParams
): Promise<void> {
  try {
    await pool.query(
      `
        INSERT INTO audit_logs (
          club_id,
          actor_user_id,
          target_user_id,
          entity_type,
          entity_id,
          session_id,
          action,
          metadata,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
      `,
      [
        params.clubId,
        params.actorUserId,
        params.targetUserId ?? null,
        params.entityType ?? null,
        params.entityId ?? null,
        params.sessionId ?? null,
        params.action,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
  } catch (err) {
    logger.error('createAuditLog failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
      action: params.action,
      clubId: params.clubId,
    });
  }
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
        al.id,
        al.action,
        al.actor_user_id,
        au.name  AS actor_name,
        al.target_user_id,
        tu.name  AS target_user_name,
        al.entity_type,
        al.entity_id,
        al.session_id,
        al.metadata,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users au ON au.id = al.actor_user_id
      LEFT JOIN users tu ON tu.id = al.target_user_id
      WHERE al.club_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [clubId, limit, offset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    targetUserId: row.target_user_id,
    targetUserName: row.target_user_name,
    entityType: row.entity_type,
    entityId: row.entity_id,
    sessionId: row.session_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}
