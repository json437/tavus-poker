import { describe, expect, it } from 'vitest'
import { ravenSignalsFromAppMessage, userSpeechFromAppMessage } from './tavusEvents'

describe('Tavus interaction event parsing', () => {
  it('extracts final user utterances for decision-window speech evidence', () => {
    const event = userSpeechFromAppMessage({
      message_type: 'conversation',
      event_type: 'conversation.utterance',
      turn_idx: 4,
      inference_id: 'inf-user-4',
      properties: {
        role: 'user',
        speech: 'I guess I call. You look way too comfortable.',
      },
    })

    expect(event).toEqual({
      text: 'I guess I call. You look way too comfortable.',
      eventType: 'conversation.utterance',
      turnIdx: 4,
      inferenceId: 'inf-user-4',
      final: true,
    })
  })

  it('uses only final user streaming utterances', () => {
    expect(
      userSpeechFromAppMessage({
        message_type: 'conversation',
        event_type: 'conversation.utterance.streaming',
        turn_idx: 5,
        properties: {
          role: 'user',
          speech: 'I am thinking',
          final: false,
        },
      }),
    ).toBeNull()

    expect(
      userSpeechFromAppMessage({
        message_type: 'conversation',
        event_type: 'conversation.utterance.streaming',
        turn_idx: 5,
        properties: {
          role: 'user',
          speech: 'I am thinking call.',
          final: true,
        },
      })?.text,
    ).toBe('I am thinking call.')
  })

  it('ignores replica utterances', () => {
    expect(
      userSpeechFromAppMessage({
        message_type: 'conversation',
        event_type: 'conversation.utterance',
        properties: {
          role: 'replica',
          speech: 'That did not sound like value.',
        },
      }),
    ).toBeNull()
  })

  it('extracts Raven poker tell tool calls', () => {
    const signals = ravenSignalsFromAppMessage({
      message_type: 'conversation',
      event_type: 'conversation.perception_tool_call',
      properties: {
        name: 'register_audio_poker_tell',
        modality: 'audio',
        arguments: JSON.stringify({
          tell_type: 'voice_shift',
          label: 'voice shifted before call',
          detail: 'The user trailed off before saying call.',
          poker_relevance: 'May indicate uncertainty while facing a bet.',
          intensity: 0.77,
        }),
      },
    })

    expect(signals).toEqual([
      {
        kind: 'voice',
        label: 'voice shifted before call',
        detail: 'The user trailed off before saying call. May indicate uncertainty while facing a bet.',
        intensity: 0.77,
      },
    ])
  })
})
