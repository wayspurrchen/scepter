/**
 * @implements {T011} Phase 3 - Added status info display
 */
import { ProjectManager } from '../../../project/project-manager.js';
import { formatTable } from '../../formatters/table-formatter.js';
import type { TypeInfo } from '../../../project/types.js';
import type { Note } from '../../../types/note.js';
import chalk from 'chalk';

export interface ListOptions {
  json?: boolean;
  stats?: boolean;
  statuses?: boolean; // @implements {T011.3.3} Show status info per type
}

export interface ListResult {
  output: string;
  types: TypeInfo[];
  typeCount: number;
}

export async function listTypes(options: ListOptions, projectPath: string): Promise<ListResult> {
  const projectManager = new ProjectManager(projectPath);

  try {
    await projectManager.initialize();

    const types = await projectManager.listNoteTypes();

    if (options.json) {
      return {
        output: JSON.stringify(types, null, 2),
        types,
        typeCount: types.length
      };
    }

    // Convert TypeInfo to fake Note objects for table formatting
    const fakeNotes: Note[] = types.map(type => ({
      id: type.shortcode,
      type: type.type,
      title: type.folder || '(anywhere)',
      tags: options.stats ? [type.noteCount.toString(), type.hasTemplate ? 'Has template' : 'No template'] : [],
      created: new Date(),
      modified: new Date(),
      content: '',
      metadata: {},
      references: { incoming: [], outgoing: [] },
      filePath: ''
    }));

    // Define columns for the table
    const columns = [
      {
        key: 'type' as keyof Note,
        header: 'Type',
        width: 20,
        format: (value: any) => value
      },
      {
        key: 'id' as keyof Note,
        header: 'Shortcode',
        width: 10,
        format: (value: any) => value
      },
      {
        key: 'title' as keyof Note,
        header: 'Folder',
        width: 25,
        format: (value: any) => value
      }
    ];

    if (options.stats) {
      columns.push(
        {
          key: 'tags' as keyof Note,
          header: 'Notes',
          width: 8,
          format: (value: string[]) => value[0] || '0'
        },
        {
          key: 'tags' as keyof Note,
          header: 'Template',
          width: 12,
          format: (value: string[]) => value[1] || 'No template'
        }
      );
    }

    let output = formatTable(fakeNotes, { columns });

    // @implements {T011.3.3} Add status info section if requested or any types have status config
    if (options.statuses || types.some(t => t.allowedStatuses)) {
      const statusOutput = formatStatusInfo(types, options.statuses);
      if (statusOutput) {
        output += '\n' + statusOutput;
      }
    }

    return {
      output,
      types,
      typeCount: types.length
    };
  } finally {
    // Always cleanup watchers, even on error
    await projectManager.cleanup();
  }
}

/**
 * Format status info for display
 * @implements {T011.3.3} Status info in type listing
 */
function formatStatusInfo(types: TypeInfo[], showAll: boolean = false): string {
  const typesWithStatuses = types.filter(t => t.allowedStatuses);

  if (typesWithStatuses.length === 0) {
    if (showAll) {
      return chalk.dim('No types have allowed statuses configured.');
    }
    return '';
  }

  const lines: string[] = [];
  lines.push(chalk.cyan(chalk.bold('Status Configuration:')));
  lines.push(chalk.dim('─'.repeat(60)));

  for (const type of typesWithStatuses) {
    if (!type.allowedStatuses) continue;

    const { mode, values, defaultValue } = type.allowedStatuses;
    const modeColor = mode === 'enforce' ? chalk.red : chalk.yellow;
    const modeLabel = modeColor(mode);
    const valuesStr = values.join(', ');
    const defaultStr = defaultValue ? chalk.dim(` [default: ${defaultValue}]`) : '';

    lines.push(`  ${chalk.green(type.type)} (${modeLabel})${defaultStr}`);
    lines.push(`    ${chalk.dim('Allowed:')} ${chalk.cyan(valuesStr)}`);
  }

  return lines.join('\n');
}