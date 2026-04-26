/**
 * Structural tests for the `meta` Commander subcommand group.
 *
 * Verifies the seven subcommands are registered with the correct argument
 * shapes and option flags per DD014 §3.DC.24-§3.DC.35.
 *
 * @validates {DD014.§3.DC.24} metaCommand barrel registers add/set/unset/clear/get/log/migrate-legacy
 * @validates {DD014.§3.DC.25} `add` accepts <claim> + variadic KEY=VALUE; --actor/--date/--note
 * @validates {DD014.§3.DC.29} `set` accepts the same arguments
 * @validates {DD014.§3.DC.30} `unset` accepts <claim> + variadic KEY (bare)
 * @validates {DD014.§3.DC.31} `clear` accepts <claim> only
 * @validates {DD014.§3.DC.32} `get` accepts <claim> + optional [key]
 * @validates {DD014.§3.DC.34} `get --json` flag
 * @validates {DD014.§3.DC.35} `log` accepts <claim>; --json flag
 */
import { describe, it, expect } from 'vitest';
import { metaCommand } from '../index';

describe('metaCommand structure', () => {
  it('is named "meta"', () => {
    expect(metaCommand.name()).toBe('meta');
  });

  it('has a description', () => {
    expect(metaCommand.description()).toBeTruthy();
    expect(metaCommand.description().toLowerCase()).toContain('metadata');
  });

  // @validates {DD014.§3.DC.24}
  it('registers the seven subcommands', () => {
    const names = metaCommand.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      'add',
      'clear',
      'get',
      'log',
      'migrate-legacy',
      'set',
      'unset',
    ]);
  });

  // @validates {DD014.§3.DC.25}
  describe('add subcommand', () => {
    const add = metaCommand.commands.find((c) => c.name() === 'add')!;

    it('exists', () => {
      expect(add).toBeDefined();
    });

    it('takes <claim> and variadic <pairs...>', () => {
      const args = add.registeredArguments;
      expect(args).toHaveLength(2);
      expect(args[0].name()).toBe('claim');
      expect(args[0].required).toBe(true);
      expect(args[1].name()).toBe('pairs');
      expect(args[1].variadic).toBe(true);
      expect(args[1].required).toBe(true);
    });

    it('exposes --actor, --date, --note, --reindex flags', () => {
      const longs = add.options.map((o) => o.long);
      expect(longs).toContain('--actor');
      expect(longs).toContain('--date');
      expect(longs).toContain('--note');
      expect(longs).toContain('--reindex');
    });
  });

  // @validates {DD014.§3.DC.29}
  describe('set subcommand', () => {
    const set = metaCommand.commands.find((c) => c.name() === 'set')!;

    it('exists', () => {
      expect(set).toBeDefined();
    });

    it('takes <claim> and variadic <pairs...>', () => {
      const args = set.registeredArguments;
      expect(args).toHaveLength(2);
      expect(args[0].name()).toBe('claim');
      expect(args[1].name()).toBe('pairs');
      expect(args[1].variadic).toBe(true);
    });
  });

  // @validates {DD014.§3.DC.30}
  describe('unset subcommand', () => {
    const unset = metaCommand.commands.find((c) => c.name() === 'unset')!;

    it('exists', () => {
      expect(unset).toBeDefined();
    });

    it('takes <claim> and variadic <keys...>', () => {
      const args = unset.registeredArguments;
      expect(args).toHaveLength(2);
      expect(args[0].name()).toBe('claim');
      expect(args[1].name()).toBe('keys');
      expect(args[1].variadic).toBe(true);
    });
  });

  // @validates {DD014.§3.DC.31}
  describe('clear subcommand', () => {
    const clear = metaCommand.commands.find((c) => c.name() === 'clear')!;

    it('exists', () => {
      expect(clear).toBeDefined();
    });

    it('takes <claim> only (no variadic)', () => {
      const args = clear.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('claim');
      expect(args[0].required).toBe(true);
    });
  });

  // @validates {DD014.§3.DC.32}
  // @validates {DD014.§3.DC.34}
  describe('get subcommand', () => {
    const get = metaCommand.commands.find((c) => c.name() === 'get')!;

    it('exists', () => {
      expect(get).toBeDefined();
    });

    it('takes <claim> and optional [key]', () => {
      const args = get.registeredArguments;
      expect(args).toHaveLength(2);
      expect(args[0].name()).toBe('claim');
      expect(args[0].required).toBe(true);
      expect(args[1].name()).toBe('key');
      expect(args[1].required).toBe(false);
    });

    it('exposes --json flag', () => {
      const longs = get.options.map((o) => o.long);
      expect(longs).toContain('--json');
    });
  });

  // @validates {DD014.§3.DC.35}
  describe('log subcommand', () => {
    const log = metaCommand.commands.find((c) => c.name() === 'log')!;

    it('exists', () => {
      expect(log).toBeDefined();
    });

    it('takes <claim>', () => {
      const args = log.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('claim');
    });

    it('exposes --json flag', () => {
      const longs = log.options.map((o) => o.long);
      expect(longs).toContain('--json');
    });
  });

  describe('migrate-legacy subcommand', () => {
    const migrate = metaCommand.commands.find((c) => c.name() === 'migrate-legacy')!;

    it('exists', () => {
      expect(migrate).toBeDefined();
    });

    it('takes no positional arguments', () => {
      expect(migrate.registeredArguments).toHaveLength(0);
    });
  });
});
