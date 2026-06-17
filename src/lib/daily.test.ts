import { describe, expect, it } from 'vitest'
import { echoTavusText, syncTavusContext } from './daily'
import type { DailyCallFrame } from './daily'

function fakeCallFrame() {
  const messages: Array<{ message: Record<string, unknown>; target: '*' | string }> = []
  const frame: DailyCallFrame = {
    on: () => undefined,
    join: async () => undefined,
    leave: async () => undefined,
    destroy: () => undefined,
    sendAppMessage: (message, target) => messages.push({ message, target }),
  }

  return { frame, messages }
}

describe('Daily/Tavus interaction messages', () => {
  it('overwrites live context snapshots instead of appending stale game states', () => {
    const { frame, messages } = fakeCallFrame()

    syncTavusContext(frame, 'c123', 'Hand 2. Pot $40.')

    expect(messages).toEqual([
      {
        target: '*',
        message: {
          message_type: 'conversation',
          event_type: 'conversation.overwrite_llm_context',
          conversation_id: 'c123',
          properties: { context: 'Hand 2. Pot $40.' },
        },
      },
    ])
  })

  it('sends explicit completed text echo for Tavus table talk', () => {
    const { frame, messages } = fakeCallFrame()

    echoTavusText(frame, 'c123', 'Interesting pause.')

    expect(messages[0]).toEqual({
      target: '*',
      message: {
        message_type: 'conversation',
        event_type: 'conversation.echo',
        conversation_id: 'c123',
        properties: {
          modality: 'text',
          text: 'Interesting pause.',
          done: true,
        },
      },
    })
  })
})
