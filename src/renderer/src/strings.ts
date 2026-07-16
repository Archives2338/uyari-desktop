import type { Platform } from '@shared/domain'

export const PLATFORM_LABEL: Record<Platform, string> = {
  GOOGLE_MEET: 'Google Meet',
  ZOOM: 'Zoom',
  MS_TEAMS: 'Microsoft Teams',
}

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
  banner: {
    title: 'Meeting detected',
    start: 'Start recording',
    starting: 'Starting…',
    dismiss: 'Dismiss',
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
    projects: 'PROJECTS',
    newProject: 'New project',
    newProjectPlaceholder: 'Project name…',
    projectsEmpty: 'Group meetings into a project to track its open items.',
    calendarTeaserTitle: 'See your meetings here',
    calendarTeaserSub:
      "Link a calendar and Uyari will show today's agenda, join reminders and notes — automatically.",
    calendarTeaserRescue: 'No calendar? Uyari still captures any meeting you join — notes will appear here.',
    recent: 'RECENT',
    firstNoteTitle: 'Take your first note',
    firstNoteSub: 'Your meeting notes will appear here',
    startCapture: 'Start capture',
    stop: 'Finish & summarize',
    pause: 'Pause',
    resume: 'Resume',
    paused: 'Paused',
    recording: 'Recording…',
    micStarting: 'Starting microphone…',
    reconnecting: 'Reconnecting to transcription… audio keeps being captured, nothing is lost.',
    detected: 'seems to be in a meeting.',
    startRecording: 'Start recording',
    dismiss: 'Dismiss',
  },
  project: {
    // Rollup de pendientes — el diferenciador. Granola deja los action items
    // atrapados dentro de cada nota; acá se juntan por proyecto.
    openItems: 'Open items',
    openItemsEmpty: 'No open items yet — they roll up here from every meeting in this project.',
    meetings: 'Meetings',
    meetingsEmpty: 'No meetings in this project yet.',
    meetingsCount: (n: number): string => `${n} meeting${n === 1 ? '' : 's'}`,
    itemsCount: (n: number): string => `${n} open item${n === 1 ? '' : 's'}`,
    addMeeting: 'Add meeting',
    addMeetingTitle: 'Add a meeting to this project',
    addMeetingEmpty: 'No other meetings to add.',
    remove: 'Remove from project',
    rename: 'Rename',
    delete: 'Delete project',
    deleteConfirm: 'Delete this project? Its meetings stay — they just leave the project.',
    back: 'Back',
    fromMeeting: 'from',
    // Descripción (contexto libre del proyecto).
    descriptionPlaceholder: 'Add a description — what is this project about?',
    // Estado vivo (reemplaza archivar sí/no).
    statusHeading: 'Status',
    statusActive: 'Active',
    statusOnHold: 'On hold',
    statusDone: 'Done',
    statusArchived: 'Archived',
    // Favorito (fijar al tope del sidebar).
    favorite: 'Add to favorites',
    unfavorite: 'Remove from favorites',
  },
  ask: {
    newChat: 'New',
    greeting: (name?: string): string => (name ? `Hi ${name}, what do you want to know?` : 'What do you want to know?'),
    flameHello: "Hi, I'm Uyari. What can I help with?",
    composerPlaceholder: 'What came up this week?',
    bottomComposerPlaceholder: 'Keep asking…',
    comingSoon: 'Coming soon',
    scopeAll: 'All meetings',
    send: 'Send',
    recentTitle: 'Recent',
    seeAll: 'See all',
    seeLess: 'See less',
    recipesTitle: 'Recipes',
    recipes: [
      'List my pending items',
      'Weekly recap',
      'Prep my next meeting',
      'Draft a follow-up',
    ],
    seeAllRecipes: 'See all ›',
    // Rotan cada 1.4s en el indicador "pensando" (patrón Claude Code).
    thinkingWords: [
      'Thinking',
      'Reviewing the meeting',
      'Piecing decisions together',
      'Connecting ideas',
      'Almost there',
    ],
    openNote: 'Open note →',
    relatedActionItems: 'Related action items',
    copy: 'Copy',
    copied: 'Copied',
    sendAsFollowUp: 'Send as follow-up',
    followUpComingSoon: 'Sending follow-ups is coming soon — copy the text for now.',
    regenerate: 'Regenerate',
    empty: "You don't have any transcribed meetings yet — start capturing one and come back to ask about it.",
    error: 'Could not reach Uyari. Try again in a moment.',
    todayGroup: 'Today',
    yesterdayGroup: 'Yesterday',
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

// Paleta de colores para el punto del proyecto en el sidebar. Project.color
// guarda el `id` (slug); `dot` es el color pintado. Sin color → neutral.
export const PROJECT_COLORS = [
  { id: 'violet', dot: 'var(--violet)' },
  { id: 'blue', dot: '#4C7DF0' },
  { id: 'mint', dot: '#3BB88F' },
  { id: 'amber', dot: '#E0A030' },
  { id: 'rose', dot: '#E5657F' },
  { id: 'slate', dot: '#8A8AA0' },
] as const

export const PROJECT_COLOR_NEUTRAL = 'var(--ink-4)'

// Orden y labels de los estados (para el menú del proyecto).
export const PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD', 'DONE', 'ARCHIVED'] as const
export const PROJECT_STATUS_LABEL: Record<(typeof PROJECT_STATUSES)[number], string> = {
  ACTIVE: S.project.statusActive,
  ON_HOLD: S.project.statusOnHold,
  DONE: S.project.statusDone,
  ARCHIVED: S.project.statusArchived,
}

/** Resuelve el color del punto desde el slug guardado (fallback neutral). */
export function projectDot(color: string | null | undefined): string {
  if (!color) return PROJECT_COLOR_NEUTRAL
  return PROJECT_COLORS.find((c) => c.id === color)?.dot ?? color
}
