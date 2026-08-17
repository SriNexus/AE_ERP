import { describe, expect, it } from 'vitest';
import { logActivity as workflowLogActivity } from '../workflow';
import { logActivity as taskLogActivity } from '../taskWorkflow';

describe('taskWorkflow re-export', () => {
  it('re-exports logActivity from workflow', () => {
    expect(taskLogActivity).toBe(workflowLogActivity);
  });
});
