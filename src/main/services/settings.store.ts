import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

// Store JSON mínimo en userData. El JWT se guarda cifrado con safeStorage
// (Keychain en macOS); el resto de settings va en claro.
//
// En DEV safeStorage se omite a propósito: el binario Electron de
// node_modules no tiene firma estable, así que el Keychain no puede
// persistir la confianza y pide la clave de macOS EN CADA ARRANQUE. En la
// app empaquetada y firmada (Developer ID) el prompt sale una sola vez.
// El token de dev es un JWT contra localhost — guardarlo en claro ahí no
// arriesga nada.

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

  private useKeychain(): boolean {
    return app.isPackaged && safeStorage.isEncryptionAvailable()
  }

  setSession(email: string, token: string): void {
    this.cache.email = email
    this.cache.tokenEncrypted = this.useKeychain()
      ? safeStorage.encryptString(token).toString('base64')
      : Buffer.from(token, 'utf8').toString('base64')
    this.persist()
  }

  get token(): string | undefined {
    const raw = this.cache.tokenEncrypted
    if (!raw) return undefined
    const buf = Buffer.from(raw, 'base64')
    // El formato se detecta por contenido, no por modo: safeStorage de
    // Chromium antepone el magic "v10"/"v11" al ciphertext; un JWT en
    // claro jamás empieza así.
    const encrypted = buf.subarray(0, 3).toString('latin1').startsWith('v1')
    if (encrypted && !this.useKeychain()) {
      // Sesión cifrada de ANTES del cambio a claro-en-dev: intentar
      // descifrarla dispararía el prompt del llavero en CADA lectura (y con
      // el mock keychain de dev fallaría igual). Descartarla una sola vez;
      // el usuario re-loguea y queda en el formato actual.
      this.clearSession()
      return undefined
    }
    try {
      return encrypted ? safeStorage.decryptString(buf) : buf.toString('utf8')
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
