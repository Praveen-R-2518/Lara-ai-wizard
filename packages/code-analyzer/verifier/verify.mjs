const actions = new Set(['click', 'valid', 'success']);

export function verifyWorkflow(workflow, routes) {
  const issues = [];
  for (const [index, step] of workflow.steps.entries()) {
    const route = routes.find(item => item.route === step.route);
    const targetCount = route?.targets.filter(target => target === step.target).length;
    if (targetCount !== 1 || !actions.has(step.action)) {
      issues.push(`Step ${index + 1} requires a supported action and exactly one matching target in its route.`);
    }
  }
  if (workflow.steps.at(-1).action !== 'success') issues.push('The final step must require a host success signal.');
  return { valid: issues.length === 0, issues };
}
