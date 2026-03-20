import fs from 'fs';
import path from 'path';

export function getDirectoryEntries(currentPath: string): fs.Dirent[] {
  return fs.readdirSync(currentPath, { withFileTypes: true });
}

export function printDirectoryTree(
  basePath: string,
  compact = false,
  tsConfigPath: string,
): { tree: string; llmOutput: string } {
  let treeResult = '';
  let llmOutput = '';

  function buildTree(currentPath: string, prefix = ''): void {
    const entries = getDirectoryEntries(currentPath);

    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      const linePrefix = compact ? '' : isLast ? '└── ' : '├── ';
      const fullPath = path.join(currentPath, entry.name);

      treeResult += `${prefix}${linePrefix}${entry.name}\n`;

      if (entry.isDirectory()) {
        const newPrefix = compact ? prefix + '  ' : prefix + (isLast ? '    ' : '│   ');
        buildTree(fullPath, newPrefix);
      }
    });
  }

  buildTree(basePath);
  return { tree: treeResult, llmOutput };
}
