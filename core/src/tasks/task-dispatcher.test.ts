import { describe, it, expect } from 'vitest';
import { TaskDispatcher } from './task-dispatcher';
import { TaskStatus } from 'src/types/task';

describe('TaskDispatcher', () => {
  describe('createTask', () => {
    it('should create a task with generated ID', async () => {
      const dispatcher = new TaskDispatcher();

      const task = await dispatcher.createTask({
        title: 'Create URL slug generator requirements',
        description: 'Design requirements for URL slug generation',
      });

      expect(task.id).toEqual('1');
      expect(task.status).toBe(TaskStatus.QUEUED);
      expect(task.createdAt).toBeInstanceOf(Date);
    });
  });
});
