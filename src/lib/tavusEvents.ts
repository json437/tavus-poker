import type { PerceptionSignal } from '../domain/opponentBrain'

export type RavenSignalInput = Pick<PerceptionSignal, 'kind' | 'label' | 'detail' | 'intensity'>

export type UserSpeechEvent = {
  text: string
  eventType: string
  turnIdx?: number
  inferenceId?: string
  final: boolean
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(numeric) ? numeric : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function parseArguments(value: unknown): UnknownRecord {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value)) ?? {}
    } catch {
      return {}
    }
  }

  return asRecord(value) ?? {}
}

function normalizeIntensity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) return 0.55
  return Math.min(1, Math.max(0, numeric > 1 ? numeric / 100 : numeric))
}

function ravenKind(modality: string, label: string, detail: string): PerceptionSignal['kind'] {
  const combined = `${label} ${detail}`.toLowerCase()
  if (modality === 'audio') return 'voice'
  if (/gaze|eye|look|avert/.test(combined)) return 'gaze'
  if (/voice|tone|speech|audio/.test(combined)) return 'voice'
  return 'expression'
}

export function ravenSignalsFromAppMessage(data: unknown): RavenSignalInput[] {
  const message = asRecord(data)
  if (!message || message.message_type !== 'conversation') return []

  const eventType = stringValue(message.event_type)
  const properties = asRecord(message.properties) ?? {}

  if (eventType === 'conversation.perception_tool_call') {
    const args = parseArguments(properties.arguments)
    const name = stringValue(properties.name)
    if (name && !/poker|tell|read/i.test(name)) return []

    const modality = stringValue(properties.modality)
    const tellType = stringValue(args.tell_type) || stringValue(args.tellType) || name || 'perception tell'
    const label = stringValue(args.label) || tellType.replaceAll('_', ' ')
    const detail =
      [stringValue(args.detail), stringValue(args.poker_relevance), stringValue(args.reason)]
        .filter(Boolean)
        .join(' ')
        .slice(0, 600) || `${label} detected by Raven ${modality || 'perception'}.`

    return [
      {
        kind: ravenKind(modality, label, detail),
        label,
        detail,
        intensity: normalizeIntensity(args.intensity ?? args.confidence),
      },
    ]
  }

  if (eventType === 'conversation.perception_analysis' || eventType === 'application.perception_analysis') {
    const analysis = stringValue(properties.analysis)
    return analysis
      ? [
          {
            kind: 'expression',
            label: 'Raven session analysis',
            detail: analysis.slice(0, 600),
            intensity: 0.5,
          },
        ]
      : []
  }

  return []
}

export function userSpeechFromAppMessage(data: unknown): UserSpeechEvent | null {
  const message = asRecord(data)
  if (!message || message.message_type !== 'conversation') return null

  const eventType = stringValue(message.event_type)
  if (eventType !== 'conversation.utterance' && eventType !== 'conversation.utterance.streaming') return null

  const properties = asRecord(message.properties) ?? {}
  if (stringValue(properties.role) !== 'user') return null

  const text = stringValue(properties.speech) || stringValue(properties.text) || stringValue(properties.transcript)
  if (!text) return null

  const final = eventType === 'conversation.utterance' ? true : booleanValue(properties.final) === true
  if (!final) return null

  return {
    text: text.slice(0, 180),
    eventType,
    turnIdx: numberValue(message.turn_idx),
    inferenceId: stringValue(message.inference_id) || undefined,
    final,
  }
}
