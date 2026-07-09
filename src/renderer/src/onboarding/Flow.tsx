import { useEffect, useState } from 'react'
import { loadFlow, saveFlow, INITIAL, type OnboardingState } from './state'
import {
  StepWelcome,
  StepSource,
  StepTeam,
  StepWorkspace,
  StepInvite,
  StepPermissions,
  StepCalendar,
  StepReady,
} from './steps'
import type { WsColorId } from '@renderer/strings'

// Controlador del onboarding (Flow.js.txt portado): estado persistido en
// localStorage, 8 pasos numerados; el paso 9 es el Home real (App decide).

const TOTAL = 8

export function OnboardingFlow({
  loggedIn,
  onDone,
}: {
  loggedIn: boolean
  onDone: () => void
}): React.JSX.Element {
  const [flow, setFlowState] = useState<OnboardingState>(() => {
    const saved = loadFlow()
    // Sin sesión siempre se arranca en el welcome/login; con sesión se
    // retoma donde quedó (mínimo paso 2: el 1 ya está cumplido).
    return { ...saved, step: loggedIn ? Math.max(2, saved.step) : 1 }
  })

  useEffect(() => saveFlow(flow), [flow])

  const patch = (p: Partial<OnboardingState>): void => setFlowState((f) => ({ ...f, ...p }))
  const next = (): void => patch({ step: flow.step + 1 })
  const back = (): void => patch({ step: Math.max(1, flow.step - 1) })

  const finish = (): void => {
    const done = { ...flow, done: true }
    saveFlow(done)
    setFlowState(done)
    onDone()
  }

  switch (flow.step) {
    case 1:
      return <StepWelcome onNext={() => patch({ step: 2 })} />
    case 2:
      return (
        <StepSource
          onNext={next}
          onBack={back}
          step={2}
          total={TOTAL}
          value={flow.source}
          onChange={(source) => patch({ source })}
        />
      )
    case 3:
      return (
        <StepTeam
          onNext={next}
          onBack={back}
          step={3}
          total={TOTAL}
          value={flow.team}
          onChange={(team) => patch({ team })}
        />
      )
    case 4:
      return (
        <StepWorkspace
          onNext={next}
          onBack={back}
          step={4}
          total={TOTAL}
          value={flow.workspace}
          onChange={(workspace) => patch({ workspace })}
          color={flow.wsColor}
          onColor={(wsColor: WsColorId) => patch({ wsColor })}
        />
      )
    case 5:
      return (
        <StepInvite
          onNext={next}
          onBack={back}
          step={5}
          total={TOTAL}
          emails={flow.emails}
          onEmails={(emails) => patch({ emails })}
        />
      )
    case 6:
      return <StepPermissions onNext={next} onBack={back} step={6} total={TOTAL} />
    case 7:
      return (
        <StepCalendar
          onNext={next}
          onBack={back}
          step={7}
          total={TOTAL}
          onLink={(calendar) => patch({ calendar })}
        />
      )
    case 8:
      return <StepReady onNext={finish} onBack={back} step={8} total={TOTAL} />
    default:
      // Paso fuera de rango (storage corrupto): reiniciar limpio.
      setFlowState({ ...INITIAL, step: loggedIn ? 2 : 1 })
      return <></>
  }
}
