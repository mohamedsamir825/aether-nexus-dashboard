/**
 * Google's protocol is the second, genuinely different shape ADR 0004 wanted to
 * be judged on. These tests pin every place the two models disagree.
 */
import { test, expect, describe } from 'bun:test';
import { modelId } from '@nexus/core';
import type { Message } from '@nexus/core';
import { toContentParts, toStopReason, toWireContents, toWireRequest } from '../src/wire.ts';

describe('roles and structure', () => {
  test('assistant becomes model; everything else becomes user', () => {
    const say = (role: Message['role']): Message => ({
      role,
      content: [{ type: 'text', text: 'x' }],
    });
    expect(toWireContents([say('assistant')])[0]?.role).toBe('model');
    expect(toWireContents([say('user')])[0]?.role).toBe('user');
    // Google has no system role: a system turn in the list is authored as user.
    expect(toWireContents([say('system')])[0]?.role).toBe('user');
    expect(toWireContents([say('tool')])[0]?.role).toBe('user');
  });

  test('the system prompt goes to its own top-level field, not a message', () => {
    const wire = toWireRequest({
      model: modelId('m'),
      system: 'be terse',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(wire.systemInstruction).toEqual({ parts: [{ text: 'be terse' }] });
    expect(wire.contents).toHaveLength(1);
  });

  test('a turn is a list of typed parts', () => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'thinking' },
        { type: 'tool_call', callId: 'c1', toolName: 'search', arguments: { q: 'x' } },
      ],
    };
    expect(toWireContents([message])[0]?.parts).toEqual([
      { text: 'thinking' },
      { functionCall: { name: 'search', args: { q: 'x' } } },
    ]);
  });

  test('empty turns are dropped rather than sent as empty parts', () => {
    expect(toWireContents([{ role: 'user', content: [{ type: 'text', text: '' }] }])).toEqual([]);
  });

  test('sampling parameters nest under generationConfig', () => {
    const wire = toWireRequest({
      model: modelId('m'),
      messages: [],
      temperature: 0.3,
      maxOutputTokens: 64,
      stopSequences: ['END'],
      responseFormat: 'json',
    });
    expect(wire.generationConfig).toEqual({
      temperature: 0.3,
      maxOutputTokens: 64,
      stopSequences: ['END'],
      responseMimeType: 'application/json',
    });
  });

  test('generationConfig is omitted entirely when nothing was set', () => {
    expect('generationConfig' in toWireRequest({ model: modelId('m'), messages: [] })).toBe(false);
  });

  test('tools are wrapped in a single functionDeclarations envelope', () => {
    const wire = toWireRequest({
      model: modelId('m'),
      messages: [],
      tools: [
        { name: 'a', description: 'x', parameters: { type: 'object' } },
        { name: 'b', description: 'y', parameters: { type: 'object' } },
      ],
    });
    expect(wire.tools).toHaveLength(1);
    expect(wire.tools?.[0]?.functionDeclarations).toHaveLength(2);
  });
});

describe('the call-id mismatch', () => {
  // NEXUS keys a tool result to the call it answers. Google keys it by function
  // NAME and has no ids at all. This is the one genuine impedance mismatch.

  test('a tool result is resolved back to its function name from the conversation', () => {
    const conversation: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_call', callId: 'call_abc', toolName: 'get_weather', arguments: {} }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', callId: 'call_abc', content: '21C' }],
      },
    ];
    const parts = toWireContents(conversation)[1]?.parts;
    expect(parts).toEqual([{ functionResponse: { name: 'get_weather', response: { output: '21C' } } }]);
  });

  test('an error result is marked as an error, not passed off as output', () => {
    const conversation: Message[] = [
      { role: 'assistant', content: [{ type: 'tool_call', callId: 'c', toolName: 'f', arguments: {} }] },
      { role: 'tool', content: [{ type: 'tool_result', callId: 'c', content: 'boom', isError: true }] },
    ];
    expect(toWireContents(conversation)[1]?.parts).toEqual([
      { functionResponse: { name: 'f', response: { error: 'boom' } } },
    ]);
  });

  test('an unresolvable call id is sent as-is rather than given an invented name', () => {
    // A wrong name would be silently wrong. An unknown one fails at the provider,
    // which is the better failure.
    const orphan: Message[] = [
      { role: 'tool', content: [{ type: 'tool_result', callId: 'from_elsewhere', content: 'r' }] },
    ];
    expect(toWireContents(orphan)[0]?.parts).toEqual([
      { functionResponse: { name: 'from_elsewhere', response: { output: 'r' } } },
    ]);
  });

  test('inbound function calls get synthesised, deterministic ids', () => {
    // Google supplies none, but NEXUS needs one to match the result back.
    const parts = toContentParts([
      { functionCall: { name: 'search', args: { q: 'a' } } },
      { functionCall: { name: 'search', args: { q: 'b' } } },
    ]);
    expect(parts.map((p) => (p.type === 'tool_call' ? p.callId : ''))).toEqual([
      'search#0',
      'search#1',
    ]);
  });

  test('a synthesised id round-trips back to the right name', () => {
    const calls = toContentParts([{ functionCall: { name: 'lookup' } }]);
    const conversation: Message[] = [
      { role: 'assistant', content: calls },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            callId: calls[0]?.type === 'tool_call' ? calls[0].callId : '',
            content: 'done',
          },
        ],
      },
    ];
    expect(toWireContents(conversation)[1]?.parts).toEqual([
      { functionResponse: { name: 'lookup', response: { output: 'done' } } },
    ]);
  });
});

describe('finish reasons', () => {
  test('maps the upper-case vocabulary', () => {
    expect(toStopReason('STOP', false)).toBe('stop');
    expect(toStopReason('MAX_TOKENS', false)).toBe('length');
    expect(toStopReason('SAFETY', false)).toBe('content_filter');
    expect(toStopReason('RECITATION', false)).toBe('content_filter');
    expect(toStopReason('PROHIBITED_CONTENT', false)).toBe('content_filter');
    expect(toStopReason('OTHER', false)).toBe('error');
    expect(toStopReason(undefined, false)).toBe('error');
  });

  test('a turn carrying function calls is tool_use even though Google says STOP', () => {
    // Reading finishReason alone would tell the agent the turn was finished
    // while it is actually waiting on a tool.
    expect(toStopReason('STOP', true)).toBe('tool_use');
  });
});

describe('inbound parts', () => {
  test('reads text and skips empty text', () => {
    expect(toContentParts([{ text: 'hi' }, { text: '' }])).toEqual([{ type: 'text', text: 'hi' }]);
  });

  test('a function call with no args yields an empty argument object', () => {
    expect(toContentParts([{ functionCall: { name: 'f' } }])[0]).toEqual({
      type: 'tool_call',
      callId: 'f#0',
      toolName: 'f',
      arguments: {},
    });
  });

  test('absent parts yield nothing rather than throwing', () => {
    expect(toContentParts(undefined)).toEqual([]);
  });
});
