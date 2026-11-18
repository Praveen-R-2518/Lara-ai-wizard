const stableId = /^[a-z][a-z0-9-]{0,63}$/;

function extractKnowledge(source) {
  const annotation = source.match(/<script id="lara-knowledge" type="application\/json">([\s\S]*?)<\/script>/);
  const words = (value, size) => typeof value === 'string' && Boolean(value.trim()) && value.length <= size;
  if (!annotation) return { description: '', answers: [] };
  let knowledge;
  try { knowledge = JSON.parse(annotation[1]); } catch { throw new Error('The lara-knowledge annotation must contain valid JSON.'); }
  if (!knowledge || (knowledge.description !== undefined && !words(knowledge.description, 500))
      || !Array.isArray(knowledge.answers) || knowledge.answers.length > 50
      || !knowledge.answers.every(item => item && words(item.question, 120) && words(item.answer, 700)
        && Array.isArray(item.aliases) && item.aliases.length <= 15 && item.aliases.every(alias => words(alias, 120)))) {
    throw new Error('Knowledge entries need a question, an answer, and an aliases array.');
  }
  return {
    description: knowledge.description ?? '',
    answers: knowledge.answers.map(({ question, answer, aliases }) => ({ question, answer, aliases }))
  };
}

export function extractApplication(source) {
  const metadata = source.match(/<script id="lara-workflows" type="application\/json">([\s\S]*?)<\/script>/);
  if (!metadata) throw new Error('Add a lara-workflows JSON annotation to the source.');
  let workflows;
  try {
    workflows = JSON.parse(metadata[1]);
  } catch {
    throw new Error('The lara-workflows annotation must contain valid JSON.');
  }
  if (!Array.isArray(workflows) || !workflows.length || workflows.length > 50) {
    throw new Error('Annotate between 1 and 50 workflows.');
  }
  const ids = new Set();
  for (const item of workflows) {
    if (!item || typeof item.id !== 'string' || !stableId.test(item.id) || ids.has(item.id)
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 90
      || !Array.isArray(item.aliases) || item.aliases.length > 25
      || !item.aliases.every(alias => typeof alias === 'string' && alias.length <= 90)
      || !Array.isArray(item.steps) || !item.steps.length || item.steps.length > 20
      || !item.steps.every(step => step && typeof step.route === 'string' && stableId.test(step.route)
        && typeof step.target === 'string' && stableId.test(step.target) && typeof step.action === 'string'
        && typeof step.instruction === 'string' && step.instruction.trim() && step.instruction.length <= 250)) {
      throw new Error('Each workflow needs a unique ID, a title, an aliases array, and valid step annotations.');
    }
    ids.add(item.id);
  }
  const routes = [...source.matchAll(/<section data-route="([a-z][a-z0-9-]{0,63})">([\s\S]*?)<\/section>/g)]
    .map(([, route, markup]) => ({
      route,
      title: markup.match(/<h1[^>]*>\s*([^<]+)<\/h1>/i)?.[1].trim() ?? route,
      targets: [...markup.matchAll(/data-lara="([a-z][a-z0-9-]{0,63})"/g)].map(([, id]) => id),
      controls: [...markup.matchAll(/<([a-z][a-z0-9]*)\b([^<>]*\sdata-lara="([a-z][a-z0-9-]{0,63})"[^<>]*)>\s*([^<]*)/gi)]
        .map(([, tag, attrs, id, label]) => ({ id, type: tag, label: (label.trim() || id.replaceAll('-', ' ')).slice(0, 100),
          destination: attrs.match(/\bhref="#([a-z][a-z0-9-]{0,63})"/)?.[1] ?? null }))
    }));
  if (!routes.length || new Set(routes.map(item => item.route)).size !== routes.length) {
    throw new Error('Annotate at least one route with a unique data-route ID.');
  }
  return {
    workflows: workflows.map(({ id, title, aliases, seed, steps }) => ({
      id, title: title.trim(), aliases, seed,
      steps: steps.map(({ route, target, action, instruction }) => ({ route, target, action, instruction }))
    })),
    routes, knowledge: extractKnowledge(source)
  };
}
