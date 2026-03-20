import chalk from 'chalk';
import type { ContextItem } from './scanner.js';

export function formatItem(item: ContextItem, includeFile = true): string {
  const noteId = chalk.cyan(`{${item.noteId}}`);
  const tags = item.tagExtensions?.length ? chalk.gray(` [${item.tagExtensions.join(', ')}]`) : '';
  const modifiers = item.inclusionModifiers
    ? chalk.yellow(
        ' ' +
          Object.entries(item.inclusionModifiers)
            .filter(([_, enabled]) => enabled)
            .map(([mod]) => {
              switch (mod) {
                case 'content':
                  return '+';
                case 'outgoingReferences':
                  return '>';
                case 'incomingReferences':
                  return '<';
                case 'contextHints':
                  return '$';
                case 'everything':
                  return '*';
                default:
                  return '';
              }
            })
            .join(''),
      )
    : '';
  const location = includeFile ? chalk.gray(` (${item.file}:${item.line})`) : chalk.gray(` (line: ${item.line})`);
  const content = item.contentExtension
    ? chalk.white(` "${item.contentExtension.substring(0, 50)}${item.contentExtension.length > 50 ? '...' : ''}"`)
    : '';

  return `${noteId}${modifiers}${tags}${content}${location}`;
}

export function formatItemsByFile(items: ContextItem[]): string {
  // Group items by file
  const byFile = items.reduce(
    (acc, item) => {
      if (!acc[item.file]) acc[item.file] = [];
      acc[item.file].push(item);
      return acc;
    },
    {} as Record<string, ContextItem[]>,
  );

  const lines: string[] = [];

  // Sort files alphabetically
  const sortedFiles = Object.keys(byFile).sort();

  sortedFiles.forEach((file, index) => {
    if (index > 0) lines.push(''); // Add blank line between files

    // File header
    lines.push(chalk.bold.underline(file));
    lines.push('');

    // Sort items by line number
    const fileItems = byFile[file].sort((a, b) => a.line - b.line);

    // Format each item without the file name
    fileItems.forEach((item) => {
      lines.push(formatItem(item, false));
    });
  });

  return lines.join('\n');
}

export function formatSummary(grouped: Record<string, ContextItem[]>): string {
  const lines: string[] = [chalk.bold('Note Mentions Summary:'), ''];

  Object.entries(grouped).forEach(([noteId, items]) => {
    const count = items.length;
    const withModifiers = items.filter((i) => i.inclusionModifiers).length;
    const withTags = items.filter((i) => i.tagExtensions?.length).length;

    let line = chalk.cyan(`{${noteId}}: ${count} mention${count !== 1 ? 's' : ''}`);

    const details: string[] = [];
    if (withModifiers > 0) details.push(`${withModifiers} with modifiers`);
    if (withTags > 0) details.push(`${withTags} with tags`);

    if (details.length > 0) {
      line += chalk.gray(` (${details.join(', ')})`);
    }

    lines.push(line);
  });

  return lines.join('\n');
}

export function formatTagCloud(tagCounts: Map<string, number>): string {
  const lines: string[] = [chalk.bold('Tag Cloud:'), ''];

  // Sort tags by count
  const sorted = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

  sorted.forEach(([tag, count]) => {
    const size = count > 10 ? 'bold' : count > 5 ? 'normal' : 'dim';
    const formatted = size === 'bold' ? chalk.bold(tag) : size === 'dim' ? chalk.gray(tag) : tag;
    lines.push(`  ${formatted} (${count})`);
  });

  return lines.join('\n');
}

export function formatMarkdown(items: ContextItem[]): string {
  const grouped = items.reduce(
    (acc, item) => {
      if (!acc[item.noteId]) acc[item.noteId] = [];
      acc[item.noteId].push(item);
      return acc;
    },
    {} as Record<string, ContextItem[]>,
  );

  const lines: string[] = ['# Note Mentions', ''];

  // Add summary
  lines.push('## Summary', '');
  Object.entries(grouped).forEach(([noteId, mentions]) => {
    lines.push(`- **{${noteId}}**: ${mentions.length} mentions`);
  });
  lines.push('');

  // Add mentions by note
  Object.entries(grouped).forEach(([noteId, mentions]) => {
    lines.push(`## {${noteId}}`, '');

    mentions.forEach((mention) => {
      const tags =
        mention.tagExtensions && mention.tagExtensions.length > 0 ? ` [${mention.tagExtensions.join(', ')}]` : '';
      const modifiers = mention.inclusionModifiers
        ? ' ' +
          Object.entries(mention.inclusionModifiers)
            .filter(([_, enabled]) => enabled)
            .map(([mod]) => {
              switch (mod) {
                case 'content':
                  return '+';
                case 'outgoingReferences':
                  return '>';
                case 'incomingReferences':
                  return '<';
                case 'contextHints':
                  return '$';
                case 'everything':
                  return '*';
                default:
                  return '';
              }
            })
            .join('')
        : '';
      const content = mention.contentExtension ? `: ${mention.contentExtension}` : '';
      lines.push(`- \`${mention.file}:${mention.line}\`${modifiers}${tags}${content}`);
    });
    lines.push('');
  });

  return lines.join('\n');
}

export function formatJson(items: ContextItem[]): string {
  const grouped = items.reduce(
    (acc, item) => {
      if (!acc[item.noteId]) acc[item.noteId] = [];
      acc[item.noteId].push(item);
      return acc;
    },
    {} as Record<string, ContextItem[]>,
  );

  return JSON.stringify(
    {
      summary: {
        total: items.length,
        byNote: Object.entries(grouped).reduce(
          (acc, [noteId, mentions]) => {
            acc[noteId] = mentions.length;
            return acc;
          },
          {} as Record<string, number>,
        ),
      },
      mentions: grouped,
    },
    null,
    2,
  );
}
