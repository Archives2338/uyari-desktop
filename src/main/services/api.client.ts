import type {
  AskAllResponse,
  CaptionSegment,
  MeetingDetailData,
  MeetingListPage,
  Platform,
} from '@shared/domain'
import type { SettingsStore } from './settings.store'

// Cliente HTTP del backend de Uyari. Mismo protocolo que usa la extensión:
// JWT Bearer centralizado, meetings identificadas por clientSessionId
// (el POST de segments hace upsert de la meeting).

const API_BASE = process.env.UYARI_API_BASE ?? 'http://localhost:3001'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface DeepgramTokenResponse {
  provider: 'deepgram'
  token: string
  expiresInSeconds: number
  ephemeral: boolean
}

/** El plan del usuario agotó su cuota mensual de transcripción (STT). */
export class SttQuotaError extends Error {
  readonly code = 'STT_QUOTA_EXCEEDED'
  constructor(message = 'Alcanzaste tu límite de transcripción de este mes.') {
    super(message)
  }
}

export class ApiClient {
  constructor(private readonly settings: SettingsStore) {}

  private async request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth) {
      const token = this.settings.token
      if (!token) throw new ApiError(401, 'Sin sesión')
      headers.Authorization = `Bearer ${token}`
    }
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status} ${body}`)
    }
    return (await res.json()) as T
  }

  async login(email: string): Promise<void> {
    const { token } = await this.request<{ token: string; userId: string }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email }) },
      false,
    )
    this.settings.setSession(email, token)
  }

  ingestSegments(
    clientSessionId: string,
    payload: {
      platform?: Platform
      title?: string
      language?: string
      segments: CaptionSegment[]
    },
  ): Promise<{ ok: boolean }> {
    return this.request(`/meetings/${clientSessionId}/segments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  finish(clientSessionId: string): Promise<{ ok: boolean }> {
    // generate:false → el desktop genera el resumen MANUAL (botón verde en el
    // panel Enhanced Notes), patrón Granola. Solo cierra la reunión acá.
    return this.request(`/meetings/${clientSessionId}/finish`, {
      method: 'POST',
      body: JSON.stringify({ generate: false }),
    })
  }

  /** Token efímero para abrir el WebSocket de STT directo al proveedor. */
  async sttToken(): Promise<{ provider: 'assemblyai'; token: string; expiresInSeconds: number }> {
    try {
      return await this.request('/stt/token', { method: 'POST', body: '{}' })
    } catch (err) {
      // 402 = cuota agotada: error terminal, no tiene sentido reintentar.
      if (err instanceof ApiError && err.status === 402) throw new SttQuotaError()
      throw err
    }
  }

  private dgToken: { value: DeepgramTokenResponse; expiresAt: number } | null = null
  private dgTokenInflight: Promise<DeepgramTokenResponse> | null = null

  /**
   * Token de Deepgram para el subprotocolo del WebSocket. `ephemeral` decide
   * el esquema: JWT del grant → 'bearer'; API key directa (fallback dev) →
   * 'token' (ver deepgram.stream.ts).
   *
   * CACHEADO con margen de 60 s (patrón Granola): los dos canales (you/them)
   * arrancan a la vez y compartían destino — sin caché eran 2 round-trips al
   * backend (+ grant de Deepgram) en el camino crítico del primer texto, y
   * uno más en cada reconexión.
   */
  async deepgramToken(): Promise<DeepgramTokenResponse> {
    if (this.dgToken && Date.now() < this.dgToken.expiresAt) return this.dgToken.value
    if (this.dgTokenInflight) return this.dgTokenInflight
    this.dgTokenInflight = (async () => {
      try {
        const fresh = await this.request<DeepgramTokenResponse>('/stt/deepgram-token', {
          method: 'POST',
          body: '{}',
        })
        this.dgToken = {
          value: fresh,
          expiresAt: Date.now() + Math.max(0, fresh.expiresInSeconds - 60) * 1000,
        }
        return fresh
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) throw new SttQuotaError()
        throw err
      } finally {
        this.dgTokenInflight = null
      }
    })()
    return this.dgTokenInflight
  }

  /**
   * Precalienta el token de STT (fire-and-forget) al detectar una reunión,
   * ANTES de que el usuario pulse grabar: el fetch sale del camino crítico
   * del arranque. Solo Deepgram — el token de AssemblyAI es de un solo uso.
   * Sin sesión o sin cuota: silencioso, el error real saldrá al grabar.
   */
  prefetchSttToken(): void {
    if (process.env.UYARI_STT === 'assemblyai') return
    void this.deepgramToken().catch(() => {})
  }

  /** Reporta segundos de STT consumidos (best-effort; medición del plan). */
  reportSttUsage(seconds: number): Promise<{ ok: boolean }> {
    return this.request('/stt/usage', { method: 'POST', body: JSON.stringify({ seconds }) })
  }

  ask(clientSessionId: string, question: string): Promise<{ answer: string }> {
    return this.request(`/meetings/${clientSessionId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    })
  }

  /** Chat global ("Pregúntale a Uyari"): contra el historial, con citas.
   *  `history` = turnos previos del mismo hilo (contexto de conversación). */
  askAll(
    question: string,
    meetingIds?: string[],
    history?: Array<{ question: string; answer: string }>,
  ): Promise<AskAllResponse> {
    return this.request('/meetings/ask', {
      method: 'POST',
      body: JSON.stringify({ question, meetingIds, history }),
    })
  }

  /** Listado paginado por cursor (más reciente primero). */
  listMeetings(params?: { cursor?: string; limit?: number }): Promise<MeetingListPage> {
    const qs = new URLSearchParams()
    if (params?.cursor) qs.set('cursor', params.cursor)
    if (params?.limit) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return this.request(`/meetings${suffix}`)
  }

  /** Detalle completo: transcript + resumen (o 404 si nunca se ingirió nada). */
  getMeeting(clientSessionId: string): Promise<MeetingDetailData> {
    return this.request(`/meetings/${clientSessionId}`)
  }

  /** Guarda las notas editables del usuario (el scratchpad, Fase 5a). */
  saveNotes(clientSessionId: string, userNotes: string): Promise<{ ok: boolean }> {
    return this.request(`/meetings/${clientSessionId}/notes`, {
      method: 'PUT',
      body: JSON.stringify({ userNotes }),
    })
  }

  /** Renombra la reunión (título de la nota en vivo). Vacío → "Untitled". */
  saveTitle(clientSessionId: string, title: string): Promise<{ ok: boolean }> {
    return this.request(`/meetings/${clientSessionId}/title`, {
      method: 'PUT',
      body: JSON.stringify({ title }),
    })
  }

  /** Guarda el content EDITADO del panel Enhanced Notes (no toca el original). */
  saveSummary(clientSessionId: string, content: string): Promise<{ ok: boolean }> {
    return this.request(`/meetings/${clientSessionId}/summary`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    })
  }

  /** Genera / regenera / reintenta el resumen, con plantilla opcional. */
  regenerateSummary(clientSessionId: string, template?: string): Promise<{ ok: boolean }> {
    return this.request(`/meetings/${clientSessionId}/summary/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ template }),
    })
  }

  /** Activa (idempotente) el link público y devuelve la URL para compartir. */
  share(clientSessionId: string): Promise<{ url: string }> {
    return this.request(`/meetings/${clientSessionId}/share`, { method: 'POST', body: '{}' })
  }
}
