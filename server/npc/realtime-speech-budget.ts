// A transport/memory guard for the serialized initial request, NOT a model
// context limit. Seeduplex counts its own tokens (including its internal prompt)
// toward 12K; there is no provider tokenizer available in this application.
// Never reject full rules/facts based on an invented character-to-token ratio.
export const REALTIME_INITIAL_PAYLOAD_BYTES = 256 * 1024;
export const REALTIME_PROVIDER_CONTEXT_TOKENS = 12000;
// Optional historical QA is separately bounded. This is not remaining tokens.
export const REALTIME_HISTORY_TEXT_CHARS = 1200;

export function realtimeInstructions(systemRole: string, speakingStyle: string): string {
  return [systemRole, speakingStyle,
    '这是实时语音通话。自然接话，允许对方插话。不要朗读表情包标记、动作描写或消息分条说明。没有真实工具结果时不要声称已执行任务。']
    .filter(Boolean).join('\n\n');
}

export function realtimeHistoryBudget(): number {
  return REALTIME_HISTORY_TEXT_CHARS;
}
