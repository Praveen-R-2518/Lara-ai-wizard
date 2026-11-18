export function applyEvent(session, event) {
  if (['completed', 'cancelled'].includes(session.status)) return { accepted: false, message: 'This session has ended.' };
  if (event.action === 'cancel') return { accepted: true, status: 'cancelled', index: session.index };
  if (event.action === 'pause' && session.status === 'active') return { accepted: true, status: 'paused', index: session.index };
  if (event.action === 'resume' && session.status === 'paused') return { accepted: true, status: 'active', index: session.index };
  if (session.status !== 'active') return { accepted: false, message: 'Resume the guide to continue.' };
  const current = session.steps[session.index];
  if (event.route !== current.route || event.target !== current.target || event.action !== current.action) {
    return { accepted: false, message: 'Follow the highlighted control to continue.' };
  }
  const index = session.index + 1;
  return { accepted: true, index, status: index === session.steps.length ? 'completed' : 'active' };
}
