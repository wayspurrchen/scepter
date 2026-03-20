import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ChatSession, ChatSessionStore } from './types';

// Simple file-based session store for now
export class FileChatSessionStore implements ChatSessionStore {
  private storePath: string;

  constructor(basePath: string = '_scepter/sessions') {
    this.storePath = basePath;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.storePath)) {
      mkdirSync(this.storePath, { recursive: true });
    }
  }

  private getSessionPath(sessionId: string): string {
    return join(this.storePath, `${sessionId}.json`);
  }

  async save(session: ChatSession): Promise<void> {
    const path = this.getSessionPath(session.id);
    writeFileSync(path, JSON.stringify(session, null, 2));
  }

  async load(sessionId: string): Promise<ChatSession | null> {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) {
      return null;
    }

    try {
      const content = readFileSync(path, 'utf-8');
      const session = JSON.parse(content);

      // Convert date strings back to Date objects
      session.createdAt = new Date(session.createdAt);
      session.updatedAt = new Date(session.updatedAt);

      return session;
    } catch (error) {
      console.error(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  }

  async list(): Promise<ChatSession[]> {
    const files = readdirSync(this.storePath).filter((f) => f.endsWith('.json'));

    const sessions: ChatSession[] = [];

    for (const file of files) {
      const sessionId = file.replace('.json', '');
      const session = await this.load(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async delete(sessionId: string): Promise<void> {
    const path = this.getSessionPath(sessionId);
    if (existsSync(path)) {
      const fs = await import('fs/promises');
      await fs.unlink(path);
    }
  }
}

// In-memory store for testing
export class InMemorySessionStore implements ChatSessionStore {
  private sessions = new Map<string, ChatSession>();

  async save(session: ChatSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async load(sessionId: string): Promise<ChatSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  async list(): Promise<ChatSession[]> {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
