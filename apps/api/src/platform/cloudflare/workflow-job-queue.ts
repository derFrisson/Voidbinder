import type { JobQueue } from '@voidbinder/core';
import { log } from '../../middleware/log';

/** Jobs as Cloudflare Workflow instances, one Workflow binding per job type. */
export class WorkflowJobQueue implements JobQueue {
  constructor(private readonly workflows: Partial<Record<string, Workflow>>) {}

  async send(job: { type: string; payload: unknown }): Promise<void> {
    const workflow = this.workflows[job.type];
    if (!workflow) throw new Error(`No Workflow for job type ${job.type}`);
    const instance = await workflow.create({ params: job.payload });
    log('info', { message: 'workflow started', job: job.type, instanceId: instance.id });
  }
}
