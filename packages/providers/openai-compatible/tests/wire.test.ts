/**
 * The mapping is where an abstraction usually leaks. These tests pin the
 * asymmetries between NEXUS's neutral shape and the OpenAI wire shape.
 */
import { test, expect, describe } from 'bun:test';
import { modelId } from '@nexus/core';
import type { Message } from '@nexus/core';
import { parseToolArguments, toStopReason, toWireMessages, toWireRequest } from '../src/wire.ts';
import { toContentParts } from '../src/wire.ts';

describe('outbound mapping', () => {
  test('joins text parts into a single content string', () => {
    const message: Message = {
      role: 'user',
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
    };
    expect(toWireMessages(message)).toEqual([{ role: 'user', content: 'hello world' }]);
  });

  test('assistant tool calls become tool_calls with stringified arguments', () => {
    const message: Message = {
      role: 'assistant',
      content: [{ type: 'tool_call', callId: 'c1', toolName: 'search', arguments: { q: 'x' } }],
    };
    const [wire] = toWireMessages(message);
    expect(wire?.role).toBe('assistant');
    expect(wire?.content).toBeNull();
    expect(wire?.tool_calls?.[0]).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 'search', arguments: '{"q":"x"}' },
    });
  });

  test('one neutral message with several tool results becomes several wire messages', () => {
    // The core asymmetry: OpenAI keys each result to its own `role: "tool"`
    // message, while NEXUS carries them as parts of one turn.
    const message: Message = {
      role: 'tool',
      content: [
        { type: 'tool_result', callId: 'c1', content: 'first' },
        { type: 'tool_result', callId: 'c2', content: 'second' },
      ],
    };
    const wire = toWireMessages(message);
    expect(wire).toHaveLength(2);
    expect(wire.map((m) => m.role)).toEqual(['tool', 'tool']);
    expect(wire.map((m) => m.tool_call_id)).toEqual(['c1', 'c2']);
  });

  test('tool results precede the turn content they belong to', () => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'done' },
        { type: 'tool_result', callId: 'c1', content: 'r' },
      ],
    };
    expect(toWireMessages(message).map((m) => m.role)).toEqual(['tool', 'assistant']);
  });

  test('a system prompt becomes the first message', () => {
    const wire = toWireRequest({
      model: modelId('m'),
      system: 'be terse',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'be terse' });
    expect(wire.messages).toHaveLength(2);
  });

  test('an empty system prompt adds no message', () => {
    const wire = toWireRequest({
      model: modelId('m'),
      system: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(wire.messages).toHaveLength(1);
  });

  test('maps optional generation parameters', () => {
    const wire = toWireRequest({
      model: modelId('m'),
      messages: [],
      temperature: 0.2,
      maxOutputTokens: 128,
      stopSequences: ['END'],
      responseFormat: 'json',
    });
    expect(wire.temperature).toBe(0.2);
    expect(wire.max_tokens).toBe(128);
    expect(wire.stop).toEqual(['END']);
    expect(wire.response_format).toEqual({ type: 'json_object' });
  });

  test('omits parameters that were not set rather than sending defaults', () => {
    const wire = toWireRequest({ model: modelId('m'), messages: [] });
    expect('temperature' in wire).toBe(false);
    expect('max_tokens' in wire).toBe(false);
    expect('response_format' in wire).toBe(false);
  });

  test('tools are wrapped in the function envelope', () => {
    const wire = toWireRequest({
      model: modelId('m'),
      messages: [],
      tools: [{ name: 'search', description: 'find', parameters: { type: 'object' } }],
    });
    expect(wire.tools?.[0]).toEqual({
      type: 'function',
      function: { name: 'search', description: 'find', parameters: { type: 'object' } },
    });
  });

  test('providerOptions passes vendor-specific keys straight through', () => {
    const wire = toWireRequest({
      model: modelId('m'),
      messages: [],
      providerOptions: { top_k: 40 },
    }) as unknown as Record<string, unknown>;
    expect(wire['top_k']).toBe(40);
  });
});

describe('inbound mapping', () => {
  test('maps finish reasons onto the neutral vocabulary', () => {
    expect(toStopReason('stop')).toBe('stop');
    expect(toStopReason('length')).toBe('length');
    expect(toStopReason('tool_calls')).toBe('tool_use');
    expect(toStopReason('content_filter')).toBe('content_filter');
    expect(toStopReason(null)).toBe('error');
    expect(toStopReason(undefined)).toBe('error');
  });

  test('reads text and tool calls out of a choice', () => {
    const parts = toContentParts({
      content: 'hi',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }],
    });
    expect(parts[0]).toEqual({ type: 'text', text: 'hi' });
    expect(parts[1]).toEqual({ type: 'tool_call', callId: 'c1', toolName: 'f', arguments: { a: 1 } });
  });

  test('an empty or absent content string produces no text part', () => {
    expect(toContentParts({ content: '' })).toEqual([]);
    expect(toContentParts({ content: null })).toEqual([]);
    expect(toContentParts(undefined)).toEqual([]);
  });

  test('malformed tool arguments are preserved, never dropped or thrown on', () => {
    // Models do emit broken JSON here. Losing the call silently would make the
    // failure invisible; throwing would take down the run.
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArguments('not json')).toEqual({ _unparsed: 'not json' });
    expect(parseToolArguments('[1,2]')).toEqual({ _value: [1, 2] });
  });
});
