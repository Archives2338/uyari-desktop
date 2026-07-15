import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { Platform } from '@shared/domain'
import { helperPath } from './capture/helper-path'

// Auto-detección de reunión (estilo Granola): el helper en modo
// --mic-monitor reporta qué apps están usando el micrófono; cuando una app
// de reuniones lo enciende, avisamos ("¿grabar esta llamada?").

// Catálogo COMPLETO portado del de Granola (tabla Ji de su main, 29 apps,
// verificada contra el bundle extraído) + los legados que ya teníamos.
const MEETING_APPS: Record<string, string> = {
  'us.zoom.xos': 'Zoom',
  'com.microsoft.teams2': 'Microsoft Teams',
  'com.microsoft.teams': 'Microsoft Teams', // cliente legacy (no está en Granola)
  'com.cisco.webexmeetingsapp': 'Webex',
  'com.apple.FaceTime': 'FaceTime',
  'com.tinyspeck.slackmacgap': 'Slack',
  'com.hnc.Discord': 'Discord',
  'net.whatsapp.WhatsApp': 'WhatsApp',
  'io.aircall.phone': 'Aircall',
  'com.tencent.tencentmeeting': 'VooV Meeting',
  'app.tuple.app': 'Tuple',
  'com.electron.dialpad': 'Dialpad',
  'com.electron.uberconference': 'Dialpad Meetings',
  'com.gather.Gather': 'Gather',
  'com.gather.GatherV2': 'Gather',
  'com.clickup.desktop-app': 'ClickUp',
  'com.larksuite.larkApp': 'Lark',
}

// Navegadores (reunión web = Meet/Teams/Zoom en pestaña). También del
// catálogo de Granola: incluye los browsers nuevos (Dia, Comet, Atlas, Zen).
const BROWSERS: Record<string, string> = {
  'com.google.Chrome': 'Chrome',
  'com.google.Chrome.beta': 'Chrome Beta',
  'com.apple.Safari': 'Safari',
  'org.mozilla.firefox': 'Firefox',
  'com.microsoft.edgemac': 'Edge',
  'com.brave.Browser': 'Brave',
  'company.thebrowser.Browser': 'Arc',
  'company.thebrowser.dia': 'Dia',
  'com.vivaldi.Vivaldi': 'Vivaldi',
  'com.operasoftware.Opera': 'Opera',
  'ai.perplexity.comet': 'Comet',
  'com.openai.atlas': 'ChatGPT Atlas',
  'app.zen-browser.zen': 'Zen Browser',
}

// Alias EXACTOS que NO se derivan por prefijo — copiados de la tabla real de
// Granola (jvt en su main, verificada contra el bundle): el audio de FaceTime
// lo captura el daemon avconferenced, el de Safari el proceso GPU de WebKit,
// Zoom tiene procesos satélite con otro bundle, y Webex clásico reporta
// Cisco-Systems.Spark. Los `.helper`/`.modulehost` de todo lo demás los
// resuelve el prefijo case-insensitive de ownerBundle (no hace falta
// enumerarlos como hace Granola).
const BUNDLE_ALIASES: Record<string, string> = {
  'us.zoom.ZoomHybridConf': 'us.zoom.xos',
  'us.zoom.ZoomPhone': 'us.zoom.xos',
  'com.apple.avconferenced': 'com.apple.FaceTime',
  'com.apple.WebKit.GPU': 'com.apple.Safari',
  'Cisco-Systems.Spark': 'com.cisco.webexmeetingsapp',
  'io.aircall.workspace.helper': 'io.aircall.phone',
}

/**
 * Resuelve el bundle "dueño" de un proceso de audio (patrón Granola: tabla de
 * alias + catálogo). Los navegadores y las apps Electron NO capturan en su
 * proceso principal sino en un helper — Core Audio reporta ESE bundle (visto
 * en vivo: Chrome en Meet aparece como `com.google.Chrome.helper`; Granola
 * alias también Discord/Slack/Teams/.modulehost). Primero alias exactos, luego
 * prefijo case-insensitive (cubre variantes como `company.thebrowser.browser.
 * helper`, con "browser" en minúscula, que Granola alias a mano).
 */
// Orden por longitud DESC: el prefijo más específico gana (p.ej.
// com.google.Chrome.beta.helper debe resolver a Chrome Beta, no a Chrome).
const KNOWN_BUNDLES = [...Object.keys(MEETING_APPS), ...Object.keys(BROWSERS)].sort(
  (a, b) => b.length - a.length,
)

function ownerBundle(bundleId: string): string {
  const alias = BUNDLE_ALIASES[bundleId]
  if (alias) return alias
  const lower = bundleId.toLowerCase()
  for (const known of KNOWN_BUNDLES) {
    const knownLower = known.toLowerCase()
    if (lower === knownLower || lower.startsWith(knownLower + '.')) return known
  }
  return bundleId
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
  // ¿Hay ALGUNA app de reunión (o navegador en llamada) usando el mic? El
  // flip true→false es la señal de FIN de reunión (patrón Granola: "left
  // meeting, considering whether to auto-stop") — la app soltó el micrófono.
  // OJO: esto NO mide audio (volumen/ruido/silencio no cuentan; mutearse en
  // Zoom tampoco — Zoom mantiene el mic abierto). Solo cuenta quién tiene
  // ABIERTO el dispositivo.
  private hadMeetingApp = false

  constructor(
    private readonly onMeetingApp: (info: { label: string; platform: Platform | null }) => void,
    /** Flip de presencia: true = apareció una app de reunión con el mic,
     *  false = TODAS lo soltaron (candidato a fin de reunión). Sin cooldown:
     *  es una señal de estado, no una notificación. */
    private readonly onMeetingPresence?: (present: boolean) => void,
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
    // `active` se actualiza recién al FINAL: si se pisa dentro del loop,
    // todo elemento después del primero deja de contar como nuevo (está en
    // el propio set que se itera) y p.ej. Zoom se pierde en silencio cuando
    // Chrome también usa el mic (los bundles llegan ordenados alfabético).
    for (const bundleId of apps) {
      if (this.active.has(bundleId) || IGNORED.has(bundleId)) continue

      // Resolver el dueño real: Chrome/Discord/Slack/Teams capturan en un
      // proceso `.helper` — el bundle crudo no matchea los mapas.
      const owner = ownerBundle(bundleId)
      const label =
        MEETING_APPS[owner] ?? (BROWSERS[owner] ? `a meeting in ${BROWSERS[owner]}` : null)
      if (!label) {
        console.log(`[mic-monitor] ${bundleId} usa el mic (no es app de reunión, ignorada)`)
        continue
      }

      // Cooldown por dueño: las variantes de helper del mismo navegador/app
      // (p.ej. dos procesos de Chrome) no deben re-notificar por separado.
      const last = this.lastNotified.get(owner) ?? 0
      if (Date.now() - last < RENOTIFY_COOLDOWN_MS) {
        console.log(`[mic-monitor] ${owner} en cooldown de notificación`)
        continue
      }
      this.lastNotified.set(owner, Date.now())
      console.log(`[mic-monitor] ${bundleId} empezó a usar el micrófono → ${label}`)
      this.onMeetingApp({ label, platform: platformFor(owner) })
    }
    this.active = apps

    // Señal de presencia (fin de reunión): ¿queda alguna app de reunión o
    // navegador con el mic abierto? Nuestra propia captura está en IGNORED,
    // así que no cuenta. El flip se reporta SIEMPRE (sin cooldown).
    const hasMeetingApp = [...apps].some((id) => {
      if (IGNORED.has(id)) return false
      const owner = ownerBundle(id)
      return MEETING_APPS[owner] !== undefined || BROWSERS[owner] !== undefined
    })
    if (hasMeetingApp !== this.hadMeetingApp) {
      this.hadMeetingApp = hasMeetingApp
      console.log(`[mic-monitor] presencia de app de reunión: ${hasMeetingApp}`)
      this.onMeetingPresence?.(hasMeetingApp)
    }
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
