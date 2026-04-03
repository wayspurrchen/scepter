/**
 * @implements {T003} - Folder-based notes creation handler
 * @implements {T011} Phase 3 - Status validation integration
 */
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { formatNote } from '../../formatters/note-formatter.js';
import type { Note } from '../../../types/note.js';
import type { CommandContext } from '../base-command.js';

export interface CreateOptions {
  type?: string; // @implements {T009} - Alternative to positional argument
  title?: string;
  content?: string;
  tags?: string[];
  editor?: boolean;
  template?: string;
  noTemplate?: boolean;
  stdin?: boolean;
  folder?: boolean; // NEW: For creating folder-based notes
  status?: string; // @implements {T009} - Note status for frontmatter
}

export interface CreateResult {
  note: Note;
  output: string;
  filePath?: string;
}

/**
 * Create a new note
 */
export async function createNote(
  type: string,
  options: CreateOptions,
  context: CommandContext
): Promise<CreateResult> {
  const { projectManager, projectPath } = context;
  const noteManager = projectManager.noteManager;
  const noteTypeResolver = projectManager.noteTypeResolver;

  if (!noteManager || !noteTypeResolver) {
    throw new Error('Note manager or type resolver not initialized');
  }

  // Resolve type from shortcode or name
  const resolvedType = noteTypeResolver.resolveTypeIdentifier(type);
  if (!resolvedType) {
    throw new Error(`Unknown note type: ${type}`);
  }

  // Use resolved type name for all operations
  type = resolvedType;

  // @implements {T011.3.1} Status validation before note creation
  const statusValidator = projectManager.statusValidator;
  let finalStatus = options.status;

  if (statusValidator) {
    // Get default status if none provided
    if (!finalStatus) {
      const defaultStatus = statusValidator.getDefaultStatus(type);
      if (defaultStatus) {
        finalStatus = defaultStatus;
      }
    }

    // Validate the status
    if (finalStatus) {
      const validationResult = statusValidator.validateStatus(finalStatus, type);

      if (!validationResult.valid) {
        // Enforce mode - block creation with error
        const allowedList = validationResult.allowedValues?.join(', ') || '';
        throw new Error(
          chalk.red(`Error: Invalid status '${finalStatus}' for type ${type}.`) +
          `\n${chalk.dim('Allowed:')} ${allowedList}`
        );
      } else if (validationResult.message && validationResult.mode === 'suggest') {
        // Suggest mode - warn but continue
        console.warn(chalk.yellow(validationResult.message));
      }
    }
  }

  // Update options with resolved status (including default if applied)
  options.status = finalStatus;

  // Prepare note content
  let content = '';
  let title = options.title;
  let noteId: string | undefined;
  let userContent = options.content;

    // If not using no-template, resolve template via storage interface
    if (!options.noTemplate) {
      const templateContent = await projectManager.templateStorage?.getTemplate(type) ?? null;
      if (templateContent) {

        // Generate ID for template substitution
        noteId = await noteManager.generateNoteId(type);

        // Substitute template variables
        content = substituteTemplateVariables(templateContent, {
          id: noteId,
          title: title || '',
          type: type,
          mode: '',
          date: formatLocalDateTime(new Date()),
        });

        // If user provided content via -c/--content, merge it with template
        if (userContent) {
          const titleMatch = content.match(/^(---[\s\S]*?---\s*\n)(#[^\n]+\n)/m);
          if (titleMatch) {
            // Keep frontmatter and title, replace everything after
            content = titleMatch[0] + '\n' + userContent;
          } else {
            // No proper template structure, just use user content
            content = userContent;
          }
        }
      } else if (userContent) {
        // No template file found, but user provided content
        content = userContent;
      }
    } else if (userContent) {
      // No template, use user content directly
      content = userContent;
    }

    // Read from stdin if requested
    if (options.stdin) {
      const stdinContent = await readStdin();

      if (content && !options.noTemplate) {
        // If we have a template, replace content after the title
        const titleMatch = content.match(/^(---[\s\S]*?---\s*\n)(#[^\n]+\n)/m);
        if (titleMatch) {
          // Keep frontmatter and title, replace everything after
          content = titleMatch[0] + '\n' + stdinContent;
        } else {
          // No proper template structure, just use stdin content
          content = stdinContent;
        }
      } else {
        // No template or --no-template specified, use raw stdin
        content = stdinContent;
      }
    }

    // If no-template is specified and no content provided, set minimal content
    if (options.noTemplate && !content && !options.stdin && !options.editor) {
      content = title ? `# ${title}\n\n` : '# New Note\n\n';
    }

    // Open in editor if requested
    if (options.editor && !options.stdin) {
      const editorContent = options.noTemplate && !content ? `# ${title || 'New Note'}\n\n` : content;
      const editorResult = await openInEditor(editorContent, type, title);
      if (editorResult === null) {
        throw new Error('Note creation cancelled');
      }
      content = editorResult.content;
      title = editorResult.title || title;
    }

    // Handle tags - merge template tags with user-provided ones
    let tags = options.tags || [];
    if (content && !options.noTemplate) {
      // Extract tags from template frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const tagsMatch = frontmatter.match(/tags:\s*\[(.*?)\]/);
        if (tagsMatch && tagsMatch[1].trim()) {
          const templateTags = tagsMatch[1].split(',').map((c) => c.trim());
          // Merge template tags with user tags (user tags take precedence)
          tags = [...new Set([...tags, ...templateTags])];
        }
      }

      // Update tags in the content if user provided any
      if (options.tags && options.tags.length > 0) {
        content = content.replace(/tags:\s*\[.*?\]/, `tags: [${tags.join(', ')}]`);
      }
    }

    // @implements {T009} - Inject status into template frontmatter if provided
    if (options.status && content) {
      const frontmatterMatch = content.match(/^(---\n[\s\S]*?)\n---/);
      if (frontmatterMatch) {
        // Add status field before the closing ---
        content = content.replace(/^(---\n[\s\S]*?)\n---/, `$1\nstatus: ${options.status}\n---`);
      }
    }

    // Create the note
    const note = await noteManager.createNote({
      type,
      id: noteId, // Use pre-generated ID if available
      title,
      content: content || undefined, // Pass content if we have it, undefined to use note manager's template
      tags,
      isFolder: options.folder, // Pass folder flag to NoteManager
      status: options.status, // @implements {T009} - Pass status to note metadata
    });

    // File path is already available in note.filePath

    const output = formatNote(note, {
      showMetadata: true,
      showContent: true,
      showReferences: false,
    });

    return {
      note,
      output,
      filePath: undefined, // filePath not available on Note type
    };
}

/**
 * Read content from stdin
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

export interface EditorResult {
  content: string;
  title?: string;
  tags?: string[];
}

/**
 * Open content in the user's editor
 */
export async function openInEditor(
  initialContent: string,
  type: string,
  initialTitle?: string,
): Promise<EditorResult | null> {
  const editor = process.env.EDITOR || 'vi';
  const tmpFile = path.join(os.tmpdir(), `scepter-note-${Date.now()}.md`);

  // Create initial content with template
  const template = `# ${type} Note

## Title
${initialTitle || '[Enter title here]'}

## Content
${initialContent || '[Enter content here]'}

## Tags
[Enter comma-separated tags]

---
# Lines starting with # at the beginning of a line will be ignored
# Save and exit to create the note, or exit without saving to cancel
`;

  await fs.writeFile(tmpFile, template, 'utf-8');

  return new Promise((resolve) => {
    const child = spawn(editor, [tmpFile], {
      stdio: 'inherit',
    });

    child.on('exit', async (code) => {
      if (code === 0) {
        try {
          const content = await fs.readFile(tmpFile, 'utf-8');
          await fs.unlink(tmpFile);

          const parsed = parseEditorContent(content);
          if (!parsed) {
            resolve(null);
          } else {
            resolve(parsed);
          }
        } catch (error) {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Parse content from editor template
 */
export function parseEditorContent(content: string): EditorResult | null {
  const lines = content.split('\n');
  const sections: { [key: string]: string[] } = {};
  let currentSection = '';
  let inMetaSection = false;

  for (const line of lines) {
    // Stop processing at the separator
    if (line.trim() === '---') {
      inMetaSection = true;
      break;
    }

    // Skip comment lines that start with #
    if (line.trimStart().startsWith('# ') && !line.startsWith('## ')) {
      continue;
    }

    // Check for section headers
    if (line.startsWith('## ')) {
      currentSection = line.substring(3).trim().toLowerCase();
      sections[currentSection] = [];
    } else if (currentSection && line.trim()) {
      sections[currentSection].push(line);
    }
  }

  const titleLines = sections['title'] || [];
  const contentLines = sections['content'] || [];
  const tagsLines = sections['tags'] || [];

  const title = titleLines.join('\n').trim();
  const noteContent = contentLines.join('\n').trim();
  const tagsStr = tagsLines.join('\n').trim();

  if (!noteContent || noteContent === '[Enter content here]') {
    return null;
  }

  const tags =
    tagsStr && tagsStr !== '[Enter comma-separated tags]'
      ? tagsStr
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c)
      : undefined;

  return {
    content: noteContent,
    title: title && title !== '[Enter title here]' ? title : undefined,
    tags,
  };
}

/**
 * Resolve template path for a given type
 */
export async function resolveTemplate(
  type: string,
  _unused: string | undefined,
  projectPath: string,
): Promise<string | null> {
  // Normalize type to lowercase for file lookup
  const normalizedType = type.toLowerCase();

  // Check global template
  const globalTemplatePath = path.join(projectPath, '_scepter/_templates', `${normalizedType}.md`);

  if (await fs.pathExists(globalTemplatePath)) {
    return globalTemplatePath;
  }

  // No template found
  return null;
}

/**
 * Format date in local timezone with ISO-like format
 */
function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  // Get timezone offset
  const offsetMinutes = date.getTimezoneOffset();
  const offsetHours = Math.abs(Math.floor(offsetMinutes / 60));
  const offsetMins = Math.abs(offsetMinutes % 60);
  const offsetSign = offsetMinutes <= 0 ? '+' : '-';
  const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetString}`;
}

/**
 * Substitute template variables
 */
export function substituteTemplateVariables(template: string, variables: Record<string, string | undefined>): string {
  let result = template;

  // Replace each variable
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      const pattern = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(pattern, value);
    }
  }

  return result;
}
