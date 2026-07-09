// Copy del onboarding, centralizado para i18n (es-419, pt-BR después).
// Portado del kit (Steps.js.txt → S). Cambio deliberado en welcome: el kit
// asume "Continue with Google"; hoy el auth real es por email, así que el
// email es el CTA primario y Google queda para cuando exista OAuth.

export const S = {
  welcome: {
    tagline: 'Focus on the meeting. Uyari writes the notes.',
    sub: 'No bot joins your call. Nothing is stored without your say-so.',
    emailPlaceholder: 'you@company.com',
    continue: 'Continue',
    signingIn: 'Signing in…',
    loginError: 'Could not sign in. Is the backend running on port 3001?',
    worksWith: 'Works with',
    platforms: 'Meet · Zoom · Teams',
    legal: 'By continuing you agree to our Terms of Service and Privacy Policy.',
  },
  source: {
    eyebrow: 'A QUICK QUESTION',
    title: 'How did you hear about Uyari?',
    options: ['Twitter / X', 'A friend or colleague', 'YouTube', 'Search', 'Podcast', 'Other'],
    skip: 'Skip',
    continue: 'Continue',
  },
  team: {
    eyebrow: 'SET UP YOUR WORKSPACE',
    title: 'How will you use Uyari?',
    options: [
      {
        id: 'me',
        title: 'Just me',
        sub: 'Personal notes across all your meetings',
        icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' as
          | string
          | string[],
      },
      {
        id: 'team',
        title: 'My team',
        sub: 'Share notes and folders with teammates',
        icon: [
          'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
          'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
          'M23 21v-2a4 4 0 0 0-3-3.87',
          'M16 3.13a4 4 0 0 1 0 7.75',
        ] as string | string[],
      },
      {
        id: 'company',
        title: 'My whole company',
        sub: 'Workspaces, admin controls and SSO',
        icon: ['M3 21h18', 'M5 21V7l7-4 7 4v14', 'M9 21v-4h6v4'] as string | string[],
      },
    ],
    continue: 'Continue',
  },
  workspace: {
    eyebrow: 'SET UP YOUR WORKSPACE',
    title: 'Name your workspace and give it a color.',
    sub: 'This will be the name of your workspace.',
    placeholder: 'Acme Inc.',
    colorLabel: 'Workspace color',
    continue: 'Continue',
  },
  invite: {
    title: 'Invite teammates',
    sub: 'Collaborate on meeting notes, share folders, and more.',
    search: 'Search by name or email',
    empty: 'Add emails above to invite your team.',
    copy: 'Copy link',
    skip: 'Skip',
    invite: 'Invite',
    privacy: 'Your meetings stay private by default unless you share them.',
  },
  permissions: {
    eyebrow: 'MACOS PERMISSIONS',
    title: 'Uyari needs two permissions',
    sub: "Uyari only records when you're in a meeting. Nothing is stored without your say-so.",
    mic: { title: 'Microphone', why: 'To hear your side of the conversation.' },
    screen: {
      title: 'Screen & system audio recording',
      why: 'To capture what others say in Meet, Zoom or Teams.',
    },
    allow: 'Allow',
    granted: 'Granted',
    denied: 'Denied',
    settings: 'Open System Settings',
    skip: 'Skip for now',
    continue: 'Continue',
  },
  calendar: {
    eyebrow: 'ONE LAST THING',
    title: 'Link your calendar',
    sub: 'See upcoming meetings and get notes attached automatically.',
    google: 'Google Calendar',
    outlook: 'Microsoft Outlook',
    comingSoon: 'Calendar sync is coming soon — we saved your choice.',
    skip: 'Skip for now',
  },
  ready: {
    eyebrow: "YOU'RE ALL SET",
    title: 'Ready when you are',
    demoTitle: 'Get started with Uyari',
    demoSub: 'Try a demo meeting (2 mins)',
    home: 'Go to Home',
  },
  home: {
    comingUp: 'Coming up',
    invite: 'Invite',
    quickNote: '+ Quick note',
    search: 'Search',
    nav: { home: 'Home', shared: 'Shared with me', ask: 'Ask Uyari' },
    spaces: 'SPACES',
    myNotes: 'My notes',
    addFolder: 'Add folder',
    linkCalendar: 'Link calendar',
    linkCalendarTitle: 'Link your calendar',
    linkCalendarSub: 'Connect Google or Microsoft to see upcoming meetings',
    firstNoteTitle: 'Take your first note',
    firstNoteSub: 'Your meeting notes will appear here',
    startCapture: 'Start capture',
    stop: 'Finish & summarize',
    reconnecting: 'Reconnecting to transcription… audio keeps being captured, nothing is lost.',
    detected: 'seems to be in a meeting.',
    startRecording: 'Start recording',
    dismiss: 'Dismiss',
  },
} as const

/** Colores de workspace — idea 2c del handoff (tiles pastel + violeta). */
export const WS_COLORS = [
  { id: 'violet', bg: 'var(--violet)', fg: '#FFFFFF' },
  { id: 'pink', bg: 'var(--pastel-pink)', fg: '#1E1B2E' },
  { id: 'yellow', bg: 'var(--pastel-yellow)', fg: '#1E1B2E' },
  { id: 'mint', bg: 'var(--pastel-mint)', fg: '#1E1B2E' },
] as const

export type WsColorId = (typeof WS_COLORS)[number]['id']
