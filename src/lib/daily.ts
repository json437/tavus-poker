const DAILY_JS_URL = 'https://unpkg.com/@daily-co/daily-js'

export type DailyAppMessageEvent = {
  data?: unknown
}

export type DailyParticipantTrack = {
  state?: string
  track?: MediaStreamTrack
  persistentTrack?: MediaStreamTrack
}

export type DailyParticipant = {
  local?: boolean
  user_name?: string
  tracks?: {
    video?: DailyParticipantTrack
    audio?: DailyParticipantTrack
  }
}

export type DailyEventName =
  | 'app-message'
  | 'participant-joined'
  | 'participant-updated'
  | 'participant-left'
  | 'track-started'
  | 'track-stopped'
  | 'joined-meeting'
  | 'left-meeting'
  | 'error'

export type DailyCallFrame = {
  on: (eventName: DailyEventName, handler: (event: DailyAppMessageEvent) => void) => void
  join: (options: { url: string; token?: string; userName?: string; userData?: unknown; startVideoOff?: boolean; startAudioOff?: boolean }) => Promise<void>
  leave: () => Promise<void>
  destroy: () => void
  sendAppMessage?: (message: Record<string, unknown>, target: '*' | string) => void
  participants?: () => Record<string, DailyParticipant>
  setLocalVideo?: (enabled: boolean) => Promise<void> | void
  setLocalAudio?: (enabled: boolean) => Promise<void> | void
}

type DailyIframeApi = {
  createCallObject: (options?: { userName?: string; userData?: unknown }) => DailyCallFrame
}

declare global {
  interface Window {
    DailyIframe?: DailyIframeApi
  }
}

let dailyScriptPromise: Promise<DailyIframeApi> | null = null

export function loadDailyIframe(): Promise<DailyIframeApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Daily can only load in the browser.'))
  }

  if (window.DailyIframe) {
    return Promise.resolve(window.DailyIframe)
  }

  if (dailyScriptPromise) {
    return dailyScriptPromise
  }

  dailyScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${DAILY_JS_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => (window.DailyIframe ? resolve(window.DailyIframe) : reject(new Error('Daily loaded without a global API.'))), { once: true })
      existing.addEventListener('error', () => reject(new Error('Could not load Daily JS.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = DAILY_JS_URL
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onload = () => (window.DailyIframe ? resolve(window.DailyIframe) : reject(new Error('Daily loaded without a global API.')))
    script.onerror = () => reject(new Error('Could not load Daily JS.'))
    document.head.appendChild(script)
  })

  return dailyScriptPromise
}

export function syncTavusContext(callFrame: DailyCallFrame | null, conversationId: string | undefined, context: string) {
  if (!callFrame?.sendAppMessage || !conversationId) return

  callFrame.sendAppMessage(
    {
      message_type: 'conversation',
      event_type: 'conversation.overwrite_llm_context',
      conversation_id: conversationId,
      properties: { context },
    },
    '*',
  )
}

export function echoTavusText(callFrame: DailyCallFrame | null, conversationId: string | undefined, text: string) {
  if (!callFrame?.sendAppMessage || !conversationId || !text.trim()) return

  callFrame.sendAppMessage(
    {
      message_type: 'conversation',
      event_type: 'conversation.echo',
      conversation_id: conversationId,
      properties: {
        modality: 'text',
        text,
        done: true,
      },
    },
    '*',
  )
}
