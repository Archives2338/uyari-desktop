import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { Platform } from '@shared/domain'
import { helperPath } from './capture/helper-path'

// Auto-detección de reunión (estilo Granola): el helper en modo
// --mic-monitor reporta qué apps están usando el micrófono; cuando una app
// de reuniones lo enciende, avisamos ("¿grabar esta llamada?").

const MEETING_APPS: Record<string, string> = {
  'us.zoom.xos': 'Zoom',
  'com.microsoft.teams2': 'Microsoft Teams',
  'com.microsoft.teams': 'Microsoft Teams',
  'com.cisco.webexmeetingsapp': 'Webex',
  'Cisco-Systems.Spark': 'Webex',
  'com.apple.FaceTime': 'FaceTime',
  'com.tinyspeck.slackmacgap': 'Slack',
  'com.hnc.Discord': 'Discord',
}

const BROWSERS: Record<string, string> = {
  'com.google.Chrome': 'Chrome',
  'com.apple.Safari': 'Safari',
  'org.mozilla.firefox': 'Firefox',
  'com.microsoft.edgemac': 'Edge',
  'com.brave.Browser': 'Brave',
  'company.thebrowser.Browser': 'Arc',
}

// Plataforma del backend por bundle id. Solo mapeamos las tres que el
// backend conoce; el resto (Webex, FaceTime, Slack, Discord) se detecta y se
// notifica igual, pero no fija la plataforma de la sesión (queda el default).
const PLATFORM_BY_BUNDLE: Record<string, Platform> = {
  'us.zoom.xos': 'ZOOM',
  'com.microsoft.teams2': 'MS_TEAMS',
  'com.microsoft.teams': 'MS_TEAMS',
}

function platformFor(bundleId: string): Platform | null {
  // Una reunión en el navegador = Google Meet (lo que capturamos por web).
  if (BROWSERS[bundleId]) return 'GOOGLE_MEET'
  return PLATFORM_BY_BUNDLE[bundleId] ?? null
}

// Nunca auto-detectarnos a nosotros mismos (Electron dev / app empaquetada).
const IGNORED = new Set(['com.github.Electron', 'com.uyari.desktop'])

const RENOTIFY_COOLDOWN_MS = 5 * 60_000

export class MicMonitorService {
  private proc: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private active = new Set<string>()
  private lastNotified = new Map<string, number>()

  constructor(
    private readonly onMeetingApp: (info: { label: string; platform: Platform | null }) => void,
  ) {}

  start(): void {
    let proc: ChildProcessByStdio<Writable, Readable, Readable>
    try {
      proc = spawn(helperPath(), ['--mic-monitor'], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      console.warn('[mic-monitor] no se pudo lanzar el helper:', err)
      return
    }
    this.proc = proc
    proc.on('error', (err) => console.warn('[mic-monitor]', err.message))
    proc.on('exit', (code) => {
      if (this.proc) console.warn(`[mic-monitor] terminó con código ${code}`)
      this.proc = null
    })
    proc.stderr.on('data', () => {
      // logs del helper: silenciados aquí (el modo captura ya los muestra)
    })

    createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg: { event?: string; apps?: string[] }
      try {
        msg = JSON.parse(line) as { event?: string; apps?: string[] }
      } catch {
        return
      }
      if (msg.event !== 'mic-apps' || !Array.isArray(msg.apps)) return
      this.handleApps(new Set(msg.apps))
    })
  }

  private handleApps(apps: Set<string>): void {
    for (const bundleId of apps) {
      const isNew = !this.active.has(bundleId)
      this.active = apps
      if (!isNew || IGNORED.has(bundleId)) continue

      const label =
        MEETING_APPS[bundleId] ??
        (BROWSERS[bundleId] ? `a meeting in ${BROWSERS[bundleId]}` : null)
      if (!label) continue // apps de mic no-reunión (dictado, etc.): ignorar

      const last = this.lastNotified.get(bundleId) ?? 0
      if (Date.now() - last < RENOTIFY_COOLDOWN_MS) continue
      this.lastNotified.set(bundleId, Date.now())
      console.log(`[mic-monitor] ${bundleId} empezó a usar el micrófono → ${label}`)
      this.onMeetingApp({ label, platform: platformFor(bundleId) })
    }
    this.active = apps
  }

  stop(): void {
    const proc = this.proc
    this.proc = null
    if (proc) {
      try {
        proc.stdin.end()
      } catch {
        // kill de respaldo
      }
      setTimeout(() => proc.kill('SIGTERM'), 500)
    }
  }
}
