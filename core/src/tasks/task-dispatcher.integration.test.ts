import { describe, it, expect, beforeAll } from 'vitest';
import { TaskDispatcher } from './task-dispatcher';
import { sendMessage } from '../llm/openai';
import { OpenAIModel } from '../llm/types';
import type { TaskConfig } from '../types/task';

describe('TaskDispatcher Integration Tests', () => {
  let dispatcher: TaskDispatcher;

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable must be set for integration tests');
    }

    dispatcher = new TaskDispatcher({
      llmFunction: sendMessage,
      defaultModel: OpenAIModel.GPT_4_1_NANO,
    });
  });

  describe('categorizeTask', () => {
    it('should categorize a frontend task correctly', async () => {
      const taskConfig: TaskConfig = {

        title: 'Add dark mode toggle to settings page',
        description:
          'Implement a toggle switch in the user settings page that allows users to switch between light and dark themes. Should persist user preference in localStorage.',
      };

      const task = await dispatcher.createTask(taskConfig);
      const categorization = await dispatcher.categorizeTask(task);

      console.log('\n=== Frontend Task Categorization ===');
      console.log('Model:', OpenAIModel.GPT_4_1_NANO);
      console.log('Task:', task.title);
      console.log('Description:', task.description);
      console.log('Tags received:', categorization);
      console.log('Number of tags:', categorization.length);

      expect(categorization).toBeDefined();
      expect(Array.isArray(categorization)).toBe(true);
      expect(categorization.length).toBeGreaterThan(0);

      // Should include frontend-related tags
      const lowerCaseTags = categorization.map((cat: string) => cat.toLowerCase());
      console.log('Lowercase tags:', lowerCaseTags);

      const hasFrontendTag = lowerCaseTags.some(
        (cat: string) =>
          cat.includes('frontend') || cat.includes('ui') || cat.includes('ux') || cat.includes('interface'),
      );
      console.log('Has frontend-related tag:', hasFrontendTag);

      expect(hasFrontendTag).toBe(true);
    });

    it('should categorize a backend API task correctly', async () => {
      const taskConfig: TaskConfig = {

        title: 'Implement user authentication endpoint',
        description:
          'Create a REST API endpoint for user authentication that validates credentials against the database and returns a JWT token.',
      };

      const task = await dispatcher.createTask(taskConfig);
      const categorization = await dispatcher.categorizeTask(task);

      console.log('\n=== Backend API Task Categorization ===');
      console.log('Model:', OpenAIModel.GPT_4_1_NANO);
      console.log('Task:', task.title);
      console.log('Description:', task.description);
      console.log('Tags received:', categorization);
      console.log('Number of tags:', categorization.length);

      expect(categorization).toBeDefined();
      expect(Array.isArray(categorization)).toBe(true);

      const lowerCaseTags = categorization.map((cat: string) => cat.toLowerCase());
      console.log('Lowercase tags:', lowerCaseTags);

      const hasBackendTag = lowerCaseTags.some(
        (cat: string) =>
          cat.includes('backend') || cat.includes('api') || cat.includes('auth') || cat.includes('security'),
      );
      console.log('Has backend-related tag:', hasBackendTag);

      expect(hasBackendTag).toBe(true);
    });

    it('should categorize a database task correctly', async () => {
      const taskConfig: TaskConfig = {

        title: 'Optimize database queries for user dashboard',
        description:
          'Analyze and optimize slow database queries on the user dashboard page. Add appropriate indexes and consider query restructuring.',
      };

      const task = await dispatcher.createTask(taskConfig);
      const categorization = await dispatcher.categorizeTask(task);

      console.log('\n=== Database Task Categorization ===');
      console.log('Model:', OpenAIModel.GPT_4_1_NANO);
      console.log('Task:', task.title);
      console.log('Description:', task.description);
      console.log('Tags received:', categorization);
      console.log('Number of tags:', categorization.length);

      expect(categorization).toBeDefined();
      expect(Array.isArray(categorization)).toBe(true);

      const lowerCaseTags = categorization.map((cat: string) => cat.toLowerCase());
      console.log('Lowercase tags:', lowerCaseTags);

      const hasDatabaseTag = lowerCaseTags.some(
        (cat: string) =>
          cat.includes('database') ||
          cat.includes('performance') ||
          cat.includes('optimization') ||
          cat.includes('backend'),
      );
      console.log('Has database-related tag:', hasDatabaseTag);

      expect(hasDatabaseTag).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw error when categorizing without LLM function', async () => {
      const dispatcherWithoutLLM = new TaskDispatcher();

      const taskConfig: TaskConfig = {

        title: 'Test task',
        description: 'Test description',
      };

      const task = await dispatcherWithoutLLM.createTask(taskConfig);

      await expect(dispatcherWithoutLLM.categorizeTask(task)).rejects.toThrow(
        'Cannot categorize task: LLM function not provided to TaskDispatcher',
      );
    });
  });
});
