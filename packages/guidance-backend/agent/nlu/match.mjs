const ignored = new Set('a an at can could do for help how i in me my of on please the to want with would you'.split(' '));
const words = value => value.toLowerCase().match(/[a-z0-9]+/g)?.filter(word => !ignored.has(word)) ?? [];

export function matchWorkflow(query, workflows) {
  const request = new Set(words(query));
  if (!request.size) return null;
  const ranked = workflows.map(workflow => {
    const phrases = [workflow.title, ...workflow.aliases];
    const score = Math.max(...phrases.map(phrase => {
      const tokens = [...new Set(words(phrase))];
      const overlap = tokens.filter(token => request.has(token)).length;
      return overlap >= Math.min(2, tokens.length) ? overlap / Math.max(tokens.length, request.size) : 0;
    }));
    return { workflow, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= .45 && ranked[0].score > (ranked[1]?.score ?? 0) ? ranked[0].workflow : null;
}
