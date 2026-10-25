/** The gen_ai tree the support agent must produce, with or without app telemetry. */
export const SUPPORT_AGENT_TREE = [
  'invoke_agent mock-support-1',
  '  step 1',
  '    chat mock-support-1',
  '    execute_tool lookup_order',
  '  step 2',
  '    chat mock-support-1',
  '    execute_tool issue_refund',
  '  step 3',
  '    chat mock-support-1',
];
