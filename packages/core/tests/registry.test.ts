import { test, expect, describe } from 'bun:test';
import { createRegistry } from '../src/registry/registry.ts';
import { createAgentRegistry } from '../src/registry/registries.ts';
import { agentId, divisionId } from '../src/ids.ts';
import { stubAgent } from './support/doubles.ts';

describe('registry', () => {
  const make = () => createRegistry<{ id: string }>('widget', (entry) => entry.id);

  test('registers and retrieves an entry', () => {
    const registry = make();
    expect(registry.register({ id: 'a' }).ok).toBe(true);
    const found = registry.get('a');
    expect(found.ok).toBe(true);
    expect(registry.size).toBe(1);
  });

  test('rejects duplicate ids instead of overwriting', () => {
    const registry = make();
    registry.register({ id: 'a' });
    const second = registry.register({ id: 'a' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('ALREADY_EXISTS');
    expect(registry.size).toBe(1);
  });

  test('rejects an empty id', () => {
    const result = make().register({ id: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });

  test('reports NOT_FOUND with the available ids for debuggability', () => {
    const registry = make();
    registry.register({ id: 'a' });
    const missing = registry.get('b');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('NOT_FOUND');
      expect(missing.error.details?.['available']).toEqual(['a']);
    }
  });

  test('unregisters', () => {
    const registry = make();
    registry.register({ id: 'a' });
    expect(registry.unregister('a').ok).toBe(true);
    expect(registry.has('a')).toBe(false);
    expect(registry.unregister('a').ok).toBe(false);
  });
});

describe('agent registry', () => {
  test('resolves an agent by division and role', () => {
    const registry = createAgentRegistry();
    registry.register(stubAgent({ id: 'cfo', division: 'finance', role: 'cfo' }));
    registry.register(stubAgent({ id: 'controller', division: 'finance', role: 'controller' }));
    registry.register(stubAgent({ id: 'architect', division: 'engineering', role: 'architect' }));

    expect(registry.findByRole(divisionId('finance'), 'controller')?.descriptor.id).toBe(agentId('controller'));
    expect(registry.findByRole(divisionId('finance'), 'nonexistent')).toBeUndefined();
    expect(registry.listByDivision(divisionId('finance'))).toHaveLength(2);
    expect(registry.size).toBe(3);
  });
});
