import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

// Store JSON mínimo en userData. El JWT se guarda cifrado con safeStorage
// (Keychain en macOS); el resto de settings va en claro.

interface Settings {
  email?: string
  tokenEncrypted?: string // base64 del buffer cifrado
  [key: string]: unknown
}

export class SettingsStore {
  private readonly file: string
  private cache: Settings

  constructor() {
    this.file = join(app.getPath('userData'), 'settings.json')
    this.cache = this.read()
  }

  private read(): Settings {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Settings
    } catch {
      return {}
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.cache, null, 2))
  }

  get email(): string | undefined {
    return this.cache.email
  }

  setSession(email: string, token: string): void {
    this.cache.email = email
    this.cache.tokenEncrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token).toString('base64')
      : Buffer.from(token, 'utf8').toString('base64')
    this.persist()
  }

  get token(): string | undefined {
    const raw = this.cache.tokenEncrypted
    if (!raw) return undefined
    const buf = Buffer.from(raw, 'base64')
    try {
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8')
    } catch {
      return undefined
    }
  }

  clearSession(): void {
    delete this.cache.email
    delete this.cache.tokenEncrypted
    this.persist()
  }
}
