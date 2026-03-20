import { ProjectManager } from '../../../project/project-manager.js';

export interface AddOptions {
  folder?: string;
  description?: string;
}

export interface AddResult {
  name: string;
  shortcode: string;
  folder?: string;
  description?: string;
}

export async function addType(
  name: string,
  shortcode: string,
  options: AddOptions,
  projectPath: string
): Promise<AddResult> {
  const projectManager = new ProjectManager(projectPath);

  try {
    await projectManager.initialize();

    // Only pass folder if explicitly provided
    await projectManager.addNoteType(name, shortcode, {
      ...(options.folder && { folder: options.folder }),
      description: options.description
    });

    return {
      name,
      shortcode: shortcode.toUpperCase(),
      folder: options.folder,
      description: options.description
    };
  } finally {
    // Always cleanup watchers, even on error
    await projectManager.cleanup();
  }
}