import { matchWorkflow } from './match.mjs';

const greeting = /^(hi|hey|hello|good morning|good afternoon)( lara)?[.! ]*$/i;
const describe = /\b(what (can|does) (i|this|the app)|what is this app|how does (this|the) app work|tell me about (this|the) app|available (pages|features))\b/i;
const followup = /^(and\b|what about\b|how about\b)|\b(next|first|last|step \d+)\b/i;

export function answerQuestion(question, { app, workflows, knowledge, routes, previousWorkflow }) {
  const intro = knowledge.description || (routes.length
    ? `The analyzed screens in ${app.name} are ${routes.map(route => route.title ?? route.route).join(', ')}.`
    : `I can help with ${app.name} once its annotated source is imported in the application workspace.`);

  if (greeting.test(question)) return { content: `Hi! Ask me about ${app.name}, or try one of the suggested questions.` };

  const articles = (knowledge.answers ?? []).map(item => ({ ...item, title: item.question }));
  const guide = matchWorkflow(question, workflows);
  if (guide) return {
    content: `Here’s how to ${guide.title.toLowerCase()} in ${app.name}.\n\n${guide.steps.map((step, index) => `${index + 1}. ${step.instruction}`).join('\n')}`,
    source: guide.title,
    workflowId: guide.id
  };

  const article = matchWorkflow(question, articles);
  if (article) return { content: article.answer, source: article.question };

  if (previousWorkflow && followup.test(question)) {
    const requested = question.match(/\bstep (\d+)\b/i);
    const detail = question.match(/\b(?:what|how) about (?:the )?([a-z-]+)/i)?.[1]?.toLowerCase();
    const selected = requested ? Number(requested[1]) - 1
      : detail ? previousWorkflow.steps.findIndex(step => step.target.includes(detail) || step.instruction.toLowerCase().includes(detail))
      : /\blast\b/i.test(question) ? previousWorkflow.steps.length - 1
      : /\bfirst\b/i.test(question) ? 0 : -1;
    const step = previousWorkflow.steps[selected];
    if (step) return {
      content: `Step ${selected + 1} of “${previousWorkflow.title}”\n\n${step.instruction}`,
      source: previousWorkflow.title, workflowId: previousWorkflow.id
    };
    if (/\bnext\b/i.test(question)) return {
      content: `Which step have you reached in “${previousWorkflow.title}”? Ask me about a step number, or start the walkthrough inside the app.`,
      source: previousWorkflow.title, workflowId: previousWorkflow.id
    };
  }

  const screens = routes.map(route => ({
    ...route, title: route.title ?? route.route, aliases: [route.route.replaceAll('-', ' ')]
  }));
  const screen = matchWorkflow(question, screens);
  const finding = /\b(where|find|screen|page|open|see)\b/i.test(question);
  if (screen && finding) {
    const labels = [...new Set(screen.controls?.map(control => control.label) ?? screen.targets ?? [])];
    return { content: `Look for “${screen.title}” in ${app.name}.${labels.length ? ` The analyzed controls on this screen include ${labels.join(', ')}.` : ''}`, source: screen.title };
  }
  if (finding) {
    const controls = new Map();
    for (const route of screens) for (const control of route.controls ?? []) {
      const entry = controls.get(control.id) ?? { title: control.label, aliases: [control.id.replaceAll('-', ' ')], screens: [] };
      entry.screens.push(route.title);
      controls.set(control.id, entry);
    }
    const control = matchWorkflow(question, [...controls.values()]);
    if (control) return { content: `Look for “${control.title}” on ${control.screens.map(title => `“${title}”`).join(' or ')} in ${app.name}.`, source: 'Analyzed screen map' };
  }

  if (describe.test(question)) return { content: intro, source: routes.length ? 'Application knowledge' : null };

  const suggestions = [...workflows.slice(0, 3).map(item => item.title), ...articles.slice(0, 2).map(item => item.question)];
  return { content: suggestions.length
    ? `I don’t have a confirmed answer to that in ${app.name} yet. Try asking about ${suggestions.map(item => `“${item}”`).join(', ')}.`
    : intro };
}
