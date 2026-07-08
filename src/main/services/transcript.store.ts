import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { CaptionSegment, Platform, SessionInfo } from '@shared/domain'

// Durabilidad local de la transcripción (patrón local-first de Granola,
// mismo rol que el espejo en chrome.storage de la extensión): cada
// segmento se escribe AQUÍ antes de intentar subirlo. Si la app crashea o
// el backend está caído, al siguiente arranque recoverOrphans() sube lo
// pendiente y cierra la reunión. El flush borra solo lo confirmado.
//
// node:sqlite (built-in de Node 22 / Electron 38, verificado en este
// entorno; API experimental → revisar al subir de Electron). WAL para que
// una escritura por caption no bloquee lecturas.

export interface OrphanSession {
  clientSessionId: string
  title: string
  platform: Platform
  ingestedAny: boolean
  pending: CaptionSegment[]
}

export class TranscriptStore {
  private db: DatabaseSync

  constructor(dbPath = join(app.getPath('userData'), 'uyari.db')) {
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        client_session_id TEXT PRIMARY KEY,
        title             TEXT NOT NULL,
        platform          TEXT NOT NULL,
        started_at_ms     INTEGER NOT NULL,
        ingested_any      INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS pending_segments (
        client_session_id   TEXT NOT NULL,
        provider_message_id TEXT NOT NULL,
        speaker             TEXT,
        text                TEXT NOT NULL,
        ts_offset_ms        INTEGER NOT NULL,
        PRIMARY KEY (client_session_id, provider_message_id)
      );
    `)
  }

  openSession(session: SessionInfo): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions (client_session_id, title, platform, started_at_ms, ingested_any)
         VALUES (?, ?, ?, ?, 0)`,
      )
      .run(session.clientSessionId, session.title, session.platform, session.startedAtMs)
  }

  /** Write-through: un upsert por caption (versión nueva pisa la anterior). */
  upsertSegment(clientSessionId: string, s: CaptionSegment): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO pending_segments
           (client_session_id, provider_message_id, speaker, text, ts_offset_ms)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(clientSessionId, s.providerMessageId, s.speaker ?? null, s.text, Math.round(s.tsOffsetMs))
  }

  /** El backend confirmó este lote: ya no hace falta conservarlo. */
  deleteSegments(clientSessionId: string, providerMessageIds: string[]): void {
    const del = this.db.prepare(
      'DELETE FROM pending_segments WHERE client_session_id = ? AND provider_message_id = ?',
    )
    for (const id of providerMessageIds) del.run(clientSessionId, id)
  }

  markIngested(clientSessionId: string): void {
    this.db
      .prepare('UPDATE sessions SET ingested_any = 1 WHERE client_session_id = ?')
      .run(clientSessionId)
  }

  /** Reunión cerrada en backend: limpiar todo rastro local. */
  closeSession(clientSessionId: string): void {
    this.db.prepare('DELETE FROM pending_segments WHERE client_session_id = ?').run(clientSessionId)
    this.db.prepare('DELETE FROM sessions WHERE client_session_id = ?').run(clientSessionId)
  }

  /** Sesiones que quedaron a medias en un arranque anterior. */
  listOrphans(): OrphanSession[] {
    const sessions = this.db
      .prepare('SELECT client_session_id, title, platform, ingested_any FROM sessions')
      .all() as Array<{
      client_session_id: string
      title: string
      platform: Platform
      ingested_any: number
    }>

    return sessions.map((row) => ({
      clientSessionId: row.client_session_id,
      title: row.title,
      platform: row.platform,
      ingestedAny: row.ingested_any === 1,
      pending: (
        this.db
          .prepare(
            `SELECT provider_message_id, speaker, text, ts_offset_ms
             FROM pending_segments WHERE client_session_id = ? ORDER BY ts_offset_ms`,
          )
          .all(row.client_session_id) as Array<{
          provider_message_id: string
          speaker: string | null
          text: string
          ts_offset_ms: number
        }>
      ).map((s) => ({
        providerMessageId: s.provider_message_id,
        speaker: s.speaker ?? undefined,
        text: s.text,
        tsOffsetMs: s.ts_offset_ms,
      })),
    }))
  }
}
