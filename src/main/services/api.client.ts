import type { CaptionSegment, Platform } from '@shared/domain'
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
    return this.request(`/meetings/${clientSessionId}/finish`, { method: 'POST', body: '{}' })
  }

  /** Token efímero para abrir el WebSocket de STT directo al proveedor. */
  sttToken(): Promise<{ provider: 'assemblyai'; token: string; expiresInSeconds: number }> {
    return this.request('/stt/token', { method: 'POST', body: '{}' })
  }

  ask(clientSessionId: string, question: string): Promise<{ answer: string }> {
    return this.request(`/meetings/${clientSessionId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    })
  }
}
