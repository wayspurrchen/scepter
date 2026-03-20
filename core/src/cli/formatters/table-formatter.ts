import chalk from 'chalk';
import Table from 'cli-table3';
import type { Note } from '../../types/note';
import { StatusMappingResolver } from '../../statuses/status-mapping-resolver';
import type { SCEpterConfig } from '../../types/config';

export interface TableColumn {
  key: keyof Note | 'references';
  header: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  format?: (value: any, note: Note) => string;
}

export interface TableOptions {
  columns?: TableColumn[];
  showHeaders?: boolean;
  showBorders?: boolean;
  maxWidth?: number;
}

const DEFAULT_COLUMNS: TableColumn[] = [
  {
    key: 'id',
    header: 'ID',
    width: 12,
    format: (value, note) => {
      let formatted = chalk.cyan(value);
      if (note.tags.includes('archived')) {
        formatted = '🗄️  ' + formatted;
      } else if (note.tags.includes('deleted')) {
        formatted = '🗑️  ' + formatted;
      }
      return formatted;
    },
  },
  {
    key: 'type',
    header: 'Type',
    width: 15,
    format: (value) => chalk.yellow(value),
  },
  {
    key: 'title',
    header: 'Title',
    width: 50,
    format: (value) => value || chalk.gray('(no title)'),
  },
  {
    key: 'tags',
    header: 'Tags',
    width: 30,
    format: (value: string[]) => value.join(', '),
  },
  {
    key: 'created',
    header: 'Created',
    width: 10,
    format: (value: Date) => value.toISOString().split('T')[0],
  },
];

/**
 * Format notes as a table
 */
export function formatTable(notes: Note[], options: TableOptions = {}): string {
  const columns = options.columns || DEFAULT_COLUMNS;

  // Calculate column widths - some dynamic, some fixed
  const colWidths = columns.map((col, colIndex) => {
    // If width is specified, use it as a fixed width
    if (col.width && col.width > 0) {
      return col.width;
    }

    // Otherwise calculate dynamic width based on content
    let maxWidth = col.header.length;

    // Check all row values to find the maximum width needed
    for (const note of notes) {
      const value = getColumnValue(note, col);
      const formatted = col.format ? col.format(value, note) : String(value);
      // Strip ANSI codes to get true visible length
      const visibleLength = formatted.replace(/\x1b\[[0-9;]*m/g, '').length;
      maxWidth = Math.max(maxWidth, visibleLength);
    }

    // Add padding (2 chars for left/right padding that cli-table3 adds)
    return maxWidth + 2;
  });

  // Create cli-table3 instance with dynamic column widths
  const table = new Table({
    head: columns.map((col) => chalk.bold(col.header)),
    colWidths: colWidths,
    chars: {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '─',
      'mid-mid': '┼',
      right: '',
      'right-mid': '',
      middle: '│',
    },
    style: {
      'padding-left': 1,
      'padding-right': 1,
    },
    wordWrap: false,
  });

  // Add rows
  for (const note of notes) {
    const row = columns.map((col) => {
      const value = getColumnValue(note, col);
      const formatted = col.format ? col.format(value, note) : String(value);
      return formatted;
    });
    table.push(row);
  }

  return table.toString();
}

/**
 * Format notes as a simple list
 */
export function formatList(
  notes: Note[],
  showDetails: boolean = false,
  config?: SCEpterConfig,
  noEmoji?: boolean,
): string {
  const statusResolver = config ? new StatusMappingResolver(config) : null;

  return notes
    .map((note) => {
      let titleLine = chalk.cyan(note.id);

      // Add status emoji if available
      if (note.metadata?.status && statusResolver && !noEmoji) {
        const mapping = statusResolver.resolve(note.metadata.status, note.type);
        if (mapping?.emoji) {
          titleLine += ` ${mapping.emoji}`;
        }
      }

      titleLine += ` - ${note.title}`;
      const lines = [titleLine];

      if (showDetails) {
        lines.push(`  Type: ${chalk.yellow(note.type)}`);
        if (note.metadata?.status) {
          lines.push(`  Status: ${note.metadata.status}`);
        }
        if (note.tags.length > 0) {
          lines.push(`  Tags: ${note.tags.join(', ')}`);
        }
        if (note.modified) {
          lines.push(`  Modified: ${note.modified.toISOString()}`);
        }
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Get column value from note
 */
function getColumnValue(note: Note, column: TableColumn): any {
  if (column.key === 'references') {
    const incoming = note.references?.incoming?.length || 0;
    const outgoing = note.references?.outgoing?.length || 0;
    return `${incoming}←→${outgoing}`;
  }
  return note[column.key as keyof Note];
}
