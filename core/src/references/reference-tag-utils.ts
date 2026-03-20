/**
 * Utilities for handling reference tag updates
 */

/**
 * Add a tag to a reference string
 * Handles various reference formats:
 * - {ID} -> {ID#tag}
 * - {ID#existing} -> {ID#existing,tag}
 * - {ID+>} -> {ID+>#tag}
 * - {ID#tag1,tag2} -> {ID#tag1,tag2,tag}
 *
 * @param referenceText - The reference text to update
 * @param tag - The tag to add (without # prefix)
 * @returns Updated reference text
 */
export function addTagToReference(referenceText: string, tag: string): string {
  // Match reference pattern: {ID} with optional modifiers and tags
  const match = referenceText.match(/^(\{[A-Z]{1,5}\d{3,5})([$+><*]*)(#[^}]+)?(\}.*)/);

  if (!match) {
    return referenceText; // Not a valid reference format
  }

  const [, idPart, modifiers, existingTags, rest] = match;

  if (existingTags) {
    // Parse existing tags
    const tagList = existingTags
      .substring(1)
      .split(',')
      .map((t) => t.trim());

    // Check if tag already exists
    if (tagList.includes(tag)) {
      return referenceText; // Tag already present
    }

    // Add new tag
    tagList.push(tag);
    return `${idPart}${modifiers}#${tagList.join(',')}${rest}`;
  } else {
    // No existing tags, add the first one
    return `${idPart}${modifiers}#${tag}${rest}`;
  }
}

/**
 * Remove a tag from a reference string
 *
 * @param referenceText - The reference text to update
 * @param tag - The tag to remove (without # prefix)
 * @returns Updated reference text
 */
export function removeTagFromReference(referenceText: string, tag: string): string {
  // Match reference pattern
  const match = referenceText.match(/^(\{[A-Z]{1,5}\d{3,5})([$+><*]*)(#[^}]+)?(\}.*)/);

  if (!match || !match[3]) {
    return referenceText; // No tags to remove
  }

  const [, idPart, modifiers, existingTags, rest] = match;

  // Parse existing tags
  const tagList = existingTags
    .substring(1)
    .split(',')
    .map((t) => t.trim());

  // Remove the specified tag
  const filteredTags = tagList.filter((t) => t !== tag);

  if (filteredTags.length === 0) {
    // No tags left, remove the tag section entirely
    return `${idPart}${modifiers}${rest}`;
  } else if (filteredTags.length === tagList.length) {
    // Tag was not present, return unchanged
    return referenceText;
  } else {
    // Some tags remain
    return `${idPart}${modifiers}#${filteredTags.join(',')}${rest}`;
  }
}

/**
 * Check if a reference has a specific tag
 *
 * @param referenceText - The reference text to check
 * @param tag - The tag to look for (without # prefix)
 * @returns True if the reference has the tag
 */
export function referenceHasTag(referenceText: string, tag: string): boolean {
  const match = referenceText.match(/^(\{[A-Z]{1,5}\d{3,5})([$+><*]*)(#[^}]+)?(\}.*)/);

  if (!match || !match[3]) {
    return false; // No tags
  }

  const existingTags = match[3];
  const tagList = existingTags
    .substring(1)
    .split(',')
    .map((t) => t.trim());

  return tagList.includes(tag);
}

/**
 * Extract all tags from a reference
 *
 * @param referenceText - The reference text to parse
 * @returns Array of tags (without # prefix)
 */
export function extractTagsFromReference(referenceText: string): string[] {
  const match = referenceText.match(/^(\{[A-Z]{1,5}\d{3,5})([$+><*]*)(#[^}]+)?(\}.*)/);

  if (!match || !match[3]) {
    return []; // No tags
  }

  const existingTags = match[3];
  return existingTags
    .substring(1)
    .split(',')
    .map((t) => t.trim());
}

/**
 * Update all references to a note ID in content by adding a tag
 *
 * @param content - The content to update
 * @param noteId - The note ID to find references for
 * @param tag - The tag to add
 * @returns Updated content and count of references updated
 */
export function addTagToAllReferences(
  content: string,
  noteId: string,
  tag: string,
): { updatedContent: string; count: number } {
  let count = 0;

  // Create regex to find all references to this note ID
  // Matches {ID} with any modifiers, tags, and content extensions
  const regex = new RegExp(`(\\{${noteId})([$+><*]*)(#[^}:]+)?([^}]*\\})`, 'g');

  const updatedContent = content.replace(regex, (match, idPart, modifiers, tags, rest) => {
    count++;

    if (tags) {
      // Parse existing tags
      const tagList = tags
        .substring(1)
        .split(',')
        .map((t: string) => t.trim());

      // Check if tag already exists
      if (tagList.includes(tag)) {
        return match; // Tag already present
      }

      // Add new tag
      tagList.push(tag);
      return `${idPart}${modifiers}#${tagList.join(',')}${rest}`;
    } else {
      // No existing tags, add the first one
      return `${idPart}${modifiers}#${tag}${rest}`;
    }
  });

  return { updatedContent, count };
}

/**
 * Update all references to a note ID in content by removing a tag
 *
 * @param content - The content to update
 * @param noteId - The note ID to find references for
 * @param tag - The tag to remove
 * @returns Updated content and count of references updated
 */
export function removeTagFromAllReferences(
  content: string,
  noteId: string,
  tag: string,
): { updatedContent: string; count: number } {
  let count = 0;

  // Create regex to find all references to this note ID
  const regex = new RegExp(`(\\{${noteId})([$+><*]*)(#[^}:]+)?([^}]*\\})`, 'g');

  const updatedContent = content.replace(
    regex,
    (match: string, idPart: string, modifiers: string, tags: string, rest: string) => {
      if (!tags) {
        return match; // No tags to remove
      }

      // Parse existing tags
      const tagList = tags
        .substring(1)
        .split(',')
        .map((t: string) => t.trim());

      // Remove the specified tag
      const filteredTags = tagList.filter((t: string) => t !== tag);

      if (filteredTags.length === tagList.length) {
        // Tag was not present
        return match;
      }

      count++;

      if (filteredTags.length === 0) {
        // No tags left, remove the tag section entirely
        return `${idPart}${modifiers}${rest}`;
      } else {
        // Some tags remain
        return `${idPart}${modifiers}#${filteredTags.join(',')}${rest}`;
      }
    },
  );

  return { updatedContent, count };
}
