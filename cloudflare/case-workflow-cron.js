const WORKFLOW_URL = 'https://unitedtraffictickets.com/api/cases/admin/workflow';

export default {
  async scheduled(_event, env) {
    const secret = String(env.CASE_WORKFLOW_CRON_SECRET || '').trim();
    if (!secret) {
      console.error('CASE_WORKFLOW_CRON_SECRET is not configured');
      return;
    }

    const response = await fetch(WORKFLOW_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-case-workflow-cron-secret': secret,
      },
      body: '{}',
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Case workflow failed (${response.status}): ${body.slice(0, 500)}`);
    }

    console.log(`Case workflow completed: ${body.slice(0, 1000)}`);
  },
};
