import { currentRoute, findTarget } from '../dom/context.js';
import { speak } from '../voice/voice.js';
import { icon } from './icons.js';
import { api as request, mountChat } from './chat.js';

export function mountLara({ app, appName = 'Application', host, navigate }) {
  const widget = document.createElement('aside');
  widget.className = 'lara';
  widget.setAttribute('aria-label', 'Lara assistant');
  widget.innerHTML = `
    <div class="lara-panel" id="lara-panel" hidden>
      <header class="lara-header"><span class="lara-logo">${icon('spark')}</span><div><strong>Ask LARA</strong><small>In-app assistant</small></div>
      <button type="button" data-hide aria-label="Minimize LARA">${icon('minus')}</button></header>
      <div class="lara-body" hidden><div class="lara-message" aria-live="polite"></div><div class="lara-controls"></div></div>
      <div class="lara-chat"></div>
    </div>
    <button type="button" class="lara-launcher" aria-expanded="false" aria-controls="lara-panel">${icon('spark')}<span>Ask LARA</span></button>`;
  document.body.append(widget);
  const panel = widget.querySelector('.lara-panel');
  const bubble = widget.querySelector('.lara-launcher');
  const message = widget.querySelector('.lara-message');
  const guidePanel = widget.querySelector('.lara-body');
  const chat = widget.querySelector('.lara-chat');
  const controls = widget.querySelector('.lara-controls');
  let session;
  let busy = false;
  let chatMounted = false;
  let transitions = Promise.resolve();
  let target;
  const ongoing = () => ['active', 'paused'].includes(session?.status);

  function highlight(scroll = false) {
    target?.classList.remove('lara-target');
    target = !panel.hidden && session?.status === 'active' ? findTarget(host, session.step) : null;
    document.body.classList.toggle('lara-guiding', Boolean(target));
    if (target) {
      target.classList.add('lara-target');
      if (scroll) target.scrollIntoView({ block: 'nearest' });
    }
  }

  function addButton(parent, label, callback, symbol) {
    const button = document.createElement('button');
    button.type = 'button';
    if (symbol) button.innerHTML = icon(symbol);
    button.append(document.createTextNode(label));
    button.addEventListener('click', callback);
    parent.append(button);
  }

  function render(note, scroll = false) {
    highlight(scroll);
    if (panel.hidden) return;
    controls.replaceChildren();
    message.replaceChildren();
    message.classList.toggle('guided', ongoing());
    chat.hidden = ongoing();
    guidePanel.hidden = !ongoing() && !note && !session;
    if (ongoing()) {
      const progress = document.createElement('strong');
      progress.className = 'lara-progress';
      progress.textContent = `Step ${session.index + 1} of ${session.total} · ${session.title}`;
      const instruction = document.createElement('p');
      instruction.textContent = session.status === 'paused' ? 'Your guide is paused. Resume when you’re ready.' : session.step.instruction;
      message.append(progress, instruction);
      if (note || (session.status === 'active' && !target)) {
        const help = document.createElement('p');
        help.className = 'lara-help';
        help.textContent = note ?? 'The expected control is on a different screen or currently unavailable.';
        message.append(help);
      }
      if (session.status === 'active' && !target && currentRoute(host) !== session.step.route && navigate) {
        addButton(controls, 'Open expected screen', () => navigate(session.step.route));
      }
      if (window.speechSynthesis && session.status === 'active') addButton(controls, 'Read step', () => speak(session.step.instruction), 'sound');
      addButton(controls, session.status === 'paused' ? 'Resume' : 'Pause', () => event({ action: session.status === 'paused' ? 'resume' : 'pause' }));
      addButton(controls, 'End guide', () => event({ action: 'cancel' }));
      return;
    }
    message.textContent = note ?? (session?.status === 'completed' ? `Done! You completed “${session.title}”.`
      : session?.status === 'cancelled' ? 'Walkthrough ended.' : '');
  }

  async function start(query) {
    if (busy || ongoing()) return;
    busy = true;
    render('Finding your guide…');
    try {
      session = await request('/api/sessions', { app, query });
      render(undefined, true);
    } catch (error) { render(error.message); } finally { busy = false; }
  }

  async function event(input) {
    if (busy || !ongoing()) return;
    busy = true;
    try {
      const next = await request(`/api/sessions/${session.id}/events`, { ...input, index: session.index });
      session = next;
      render(next.message, next.accepted);
    } catch (error) { render(error.message); } finally { busy = false; }
  }

  function setOpen(open) {
    panel.hidden = !open;
    bubble.setAttribute('aria-expanded', String(open));
    render();
    if (open) {
      if (!chatMounted) {
        mountChat(chat, { apps: [{ id: app, name: appName }], compact: true, onWalkthrough: start });
        chatMounted = true;
      }
      (ongoing() ? widget.querySelector('[data-hide]') : chat.querySelector('textarea'))?.focus();
    } else bubble.focus();
  }

  bubble.addEventListener('click', () => setOpen(panel.hidden));
  widget.querySelector('[data-hide]').addEventListener('click', () => setOpen(false));
  widget.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });
  function capture(action, id) {
    if (panel.hidden || session?.status !== 'active' || !session.step || !id) return;
    const input = { route: currentRoute(host), target: id, action };
    transitions = transitions.then(() => event(input));
  }

  host.addEventListener('click', e => {
    const element = e.target.closest('[data-lara]');
    if (element && session?.step?.action === 'click') capture('click', element.dataset.lara);
  }, true);
  host.addEventListener('focusout', e => {
    const element = e.target;
    if (session?.step?.action === 'valid' && element.matches('[data-lara]') && element.validity?.valid) capture('valid', element.dataset.lara);
  });
  host.addEventListener('submit', e => {
    const focused = document.activeElement;
    if (session?.step?.action === 'valid' && e.target.contains(focused)
      && focused.dataset.lara === session.step.target && focused.validity?.valid) {
      capture('valid', focused.dataset.lara);
    }
  }, true);
  document.addEventListener('lara:route', () => render(undefined, true));
  document.addEventListener('lara:success', e => capture('success', e.detail?.target));
}
