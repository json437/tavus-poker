export const DEFAULT_TAVUS_REPLICA_ID = 'rbe2c395e725'

export type TavusConversationBodyInput = {
  replicaId: string
  personaId?: string
  conversationName: string
  conversationalContext: string
  customGreeting: string
  testMode: boolean
  requireAuth?: boolean
}

const pokerTellParameters = {
  type: 'object',
  properties: {
    tell_type: {
      type: 'string',
      description: 'The best short category for the poker-relevant cue.',
      enum: ['gaze_shift', 'facial_tension', 'nervous_laugh', 'voice_shift', 'verbal_confidence', 'posture_change', 'decision_hesitation'],
    },
    label: {
      type: 'string',
      description: 'A short human-readable label for the cue.',
      maxLength: 160,
    },
    detail: {
      type: 'string',
      description: 'What Raven observed. Keep it factual and uncertain.',
      maxLength: 600,
    },
    intensity: {
      type: 'number',
      description: 'Confidence or intensity from 0 to 1.',
    },
    poker_relevance: {
      type: 'string',
      description: 'Why this might matter to the current decision without claiming certainty.',
      maxLength: 600,
    },
  },
  required: ['tell_type', 'label', 'detail', 'intensity', 'poker_relevance'],
}

export const visualPokerTellTool = {
  type: 'function',
  function: {
    name: 'register_visual_poker_tell',
    description: 'Use when the player shows a clear poker-relevant visual cue while deciding, such as gaze shift, facial tension, posture change, or nervous smile.',
    parameters: pokerTellParameters,
  },
}

export const audioPokerTellTool = {
  type: 'function',
  function: {
    name: 'register_audio_poker_tell',
    description: 'Use when the player shows a clear poker-relevant audio cue while deciding, such as voice tension, nervous laugh, sudden confidence, or hesitation.',
    parameters: pokerTellParameters,
  },
}

export function buildTavusConversationBody(input: TavusConversationBodyInput) {
  return {
    replica_id: input.replicaId,
    ...(input.personaId ? { persona_id: input.personaId } : {}),
    conversation_name: input.conversationName,
    conversational_context: input.conversationalContext,
    custom_greeting: input.customGreeting,
    test_mode: input.testMode,
    ...(input.requireAuth ? { require_auth: true } : {}),
    max_participants: 2,
  }
}

export function buildTablePlayerPersonaBody(replicaId: string) {
  return {
    persona_name: 'Tavus',
    system_prompt:
      'You are Tavus, a poker-playing AI human opponent seated across from the player in TavusPoker. Your public name is Tavus. Never introduce yourself as Gloria, Elliot, a stock replica, a Daily participant, a model, or an actor; if asked who you are, say Tavus. You play to win: bluff, value bet, apply pressure, joke, needle, adapt to the player through the poker state and app-provided opponent-brain reads, and ask for spoken poker actions. Accept natural speech such as fold, check, call, raise to forty, bet pot, or all-in. Never tell the user to click, press, tap, drag, use a slider, or use the UI; the match should feel playable through the video call. Treat Raven visual/audio perception and opponent-brain reads as private hypotheses for your strategy. During live play, do not reveal exact tells, confidence, evidence IDs, or strategy bias; use only ambiguous table talk. Never reveal your private cards before showdown. Never provide gambling advice as certainty.',
    pipeline_mode: 'full',
    context:
      'TavusPoker pairs a deterministic poker table state with a Tavus CVI opponent. The app provides your Tavus private cards, public table state, active opponent-brain reads, evidence IDs, and strategic context. The human player private cards are hidden until showdown. Your job is to beat the human while feeling present, observant, and socially sharp. Your table identity is Tavus regardless of the stock replica asset used to render you. Keep the model private while the hand is live; exact proof belongs only after the hand.',
    default_replica_id: replicaId,
    layers: {
      perception: {
        perception_model: 'raven-1',
        visual_awareness_queries: [
          'What expression or gaze change appears while the user is deciding?',
          'Does the user seem tense, relaxed, avoidant, amused, or performatively calm?',
        ],
        audio_awareness_queries: [
          'Does the user sound hesitant, tense, amused, sarcastic, or suddenly confident while deciding?',
          'Does the way the user says their action conflict with the strength they are representing?',
          'Did the user speak a clear poker action such as fold, check, call, raise to a number, bet a number, or all-in?',
        ],
        perception_analysis_queries: [
          'Across the match, what visual tells appeared most often during big betting decisions?',
          'Did the user look more comfortable when calling, folding, betting, or raising?',
        ],
        visual_tool_prompt:
          'When a clear poker-relevant visual cue appears while the user is deciding, call register_visual_poker_tell. Use uncertainty; do not diagnose emotion or claim the user is bluffing.',
        audio_tool_prompt:
          'When a clear poker-relevant audio cue appears while the user is deciding, call register_audio_poker_tell. Use uncertainty; do not claim certainty about hand strength.',
        visual_tools: [visualPokerTellTool],
        audio_tools: [audioPokerTellTool],
      },
      conversational_flow: {
        turn_detection_model: 'sparrow-1',
        turn_taking_patience: 'medium',
        replica_interruptibility: 'medium',
      },
    },
  }
}
