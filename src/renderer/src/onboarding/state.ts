import type { WsColorId } from '@renderer/strings'

// Estado del onboarding, persistido en localStorage (misma clave y shape
// que el kit de diseño). Todo es LOCAL: source/team/workspace/emails/
// calendar no llaman a ningún backend todavía — se guardan para cuando
// existan workspaces reales. Cero impacto en main/IPC.

export const FLOW_KEY = 'uyari-desktop-onboarding-v1'

export interface OnboardingState {
  step: number
  source: string
  team: string
  workspace: string
  wsColor: WsColorId
  emails: string[]
  /** Proveedor elegido ('Google Calendar' | 'Microsoft Outlook') o null. */
  calendar: string | null | undefined
  /** El usuario llegó al Home: no volver a mostrar el wizard. */
  done: boolean
}

export const INITIAL: OnboardingState = {
  step: 1,
  source: '',
  team: '',
  workspace: '',
  wsColor: 'violet',
  emails: [],
  calendar: undefined,
  done: false,
}

export function loadFlow(): OnboardingState {
  try {
    const raw = localStorage.getItem(FLOW_KEY)
    if (!raw) return INITIAL
    return { ...INITIAL, ...(JSON.parse(raw) as Partial<OnboardingState>) }
  } catch {
    return INITIAL
  }
}

export function saveFlow(state: OnboardingState): void {
  localStorage.setItem(FLOW_KEY, JSON.stringify(state))
}
