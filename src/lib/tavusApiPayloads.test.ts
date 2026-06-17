import { describe, expect, it } from 'vitest'
import { DEFAULT_TAVUS_REPLICA_ID, buildTablePlayerPersonaBody, buildTavusConversationBody } from './tavusApiPayloads'

describe('Tavus API payloads', () => {
  it('always sends a replica id with the persona id for live conversations', () => {
    const body = buildTavusConversationBody({
      replicaId: 'r_live',
      personaId: 'p_table',
      conversationName: 'TavusPoker hand 4',
      conversationalContext: 'Current hand context',
      customGreeting: 'You are up.',
      testMode: true,
      requireAuth: true,
    })

    expect(body).toMatchObject({
      replica_id: 'r_live',
      persona_id: 'p_table',
      conversation_name: 'TavusPoker hand 4',
      conversational_context: 'Current hand context',
      custom_greeting: 'You are up.',
      test_mode: true,
      require_auth: true,
      max_participants: 2,
    })
  })

  it('creates a Raven-enabled poker persona with visual and audio tell tools', () => {
    const body = buildTablePlayerPersonaBody('r_live')
    const perception = body.layers.perception

    expect(DEFAULT_TAVUS_REPLICA_ID).toBe('rbe2c395e725')
    expect(body.persona_name).toBe('Tavus')
    expect(body.default_replica_id).toBe('r_live')
    expect(body.pipeline_mode).toBe('full')
    expect(body.context).toContain('your Tavus private cards')
    expect(body.context).toContain('human player private cards are hidden until showdown')
    expect(body.context).toContain('table identity is Tavus')
    expect(body.system_prompt).toContain('Your public name is Tavus')
    expect(body.system_prompt).toContain('if asked who you are, say Tavus')
    expect(body.system_prompt).toContain('ask for spoken poker actions')
    expect(body.system_prompt).toContain('Never tell the user to click')
    expect(body.system_prompt).toContain('Treat Raven visual/audio perception')
    expect(perception.perception_model).toBe('raven-1')
    expect(perception.visual_tools[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'register_visual_poker_tell',
        parameters: {
          type: 'object',
          required: ['tell_type', 'label', 'detail', 'intensity', 'poker_relevance'],
        },
      },
    })
    expect(perception.audio_tools[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'register_audio_poker_tell',
        parameters: {
          type: 'object',
          required: ['tell_type', 'label', 'detail', 'intensity', 'poker_relevance'],
        },
      },
    })
  })
})
