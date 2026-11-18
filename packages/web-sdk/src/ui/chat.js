import { icon } from './icons.js';
import { captureSpeech, voiceAvailable } from '../voice/voice.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export async function api(path, body) {
  const options = body === undefined ? {} :
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'LARA couldn’t complete the request.');
  return data;
}

const models = new Map();
const changes = new EventTarget();
const memoKey = app => `lara.conversation.${app}`;
function model(app) {
  if (!models.has(app)) {
    models.set(app, { thread: null, messages: [], suggestions: [], threads: [], ready: false, busy: false, error: '' });
  }
  return models.get(app);
}

function notify(app) {
  changes.dispatchEvent(new CustomEvent('chat', { detail: app }));
}

function remember(app, thread) {
  try {
    if (thread) localStorage.setItem(memoKey(app), thread);
    else localStorage.removeItem(memoKey(app));
  } catch {}
}

function remembered(app) {
  try { return localStorage.getItem(memoKey(app)); } catch { return null; }
}

async function load(app) {
  const data = model(app);
  if (data.busy) return;
  data.busy = true;
  data.error = '';
  notify(app);
  try {
    const index = await api(`/api/chat?app=${encodeURIComponent(app)}`);
    const last = data.ready ? data.thread : remembered(app);
    if (last && index.threads.some(thread => thread.id === last)) {
      data.messages = await api(`/api/chat/thread?app=${encodeURIComponent(app)}&thread=${encodeURIComponent(last)}`);
      data.thread = last;
    }
    Object.assign(data, index, { ready: true });
  } catch (error) { data.error = error.message; }
  finally { data.busy = false; notify(app); }
}

export function mountChat(container, { apps, appId, compact = false, onApp, onWalkthrough } = {}) {
  let selected = apps.some(app => app.id === appId) ? appId : apps[0]?.id;
  let sending = false;
  let listening = false;
  const name = () => apps.find(app => app.id === selected)?.name ?? 'your application';
  const threadUrl = () => `/#conversations/${encodeURIComponent(selected ?? '')}`;
  if (!selected) {
    container.textContent = 'Register an application to start a conversation.';
    return () => {};
  }

  const context = apps.length > 1
    ? `<label class="chat-context"><span>Application</span><select aria-label="Chat application">${apps.map(app =>
      `<option value="${escapeHtml(app.id)}" ${app.id === selected ? 'selected' : ''}>${escapeHtml(app.name)}</option>`).join('')}</select></label>`
    : `<div class="chat-context"><span>Application</span><strong>${escapeHtml(name())}</strong></div>`;
  container.innerHTML = `<section class="chat-interface ${compact ? 'chat-compact' : 'chat-full'}" aria-label="Application conversation">
    <aside class="chat-history" aria-label="Conversation history">
      ${context}
      <button type="button" class="chat-new" data-new>${icon('plus')} New chat</button>
      ${compact ? '<details><summary>Recent conversations</summary><div class="chat-threads"></div></details>' :
        '<h2>Recent conversations</h2><div class="chat-threads"></div>'}
    </aside>
    <div class="chat-main">
      <header class="chat-heading"><span class="chat-mini-logo">${icon('spark')}</span><div><strong>LARA</strong><span class="chat-subtitle"></span></div>
      ${compact ? '<a class="chat-expand" aria-label="Open Conversations" title="Open Conversations">' + icon('external') + '</a>' : ''}</header>
      <div class="chat-log" role="log" aria-label="Messages"></div>
      <div class="chat-status" role="status"></div>
      <form class="chat-form"><textarea required maxlength="1200" rows="1" aria-label="Message LARA" placeholder="Ask LARA about this application…"></textarea>
        <button type="button" class="chat-mic" aria-label="Speak a message" ${voiceAvailable() ? '' : 'hidden'}>${icon('mic')}</button>
        <button class="chat-send" aria-label="Send message">${icon('send')}</button></form>
    </div>
  </section>`;

  const log = container.querySelector('.chat-log');
  const history = container.querySelector('.chat-threads');
  const subtitle = container.querySelector('.chat-subtitle');
  const form = container.querySelector('form');
  const input = form.querySelector('textarea');
  const status = container.querySelector('.chat-status');
  const mic = form.querySelector('.chat-mic');
  const expand = container.querySelector('.chat-expand');
  const newChat = container.querySelector('[data-new]');

  function render() {
    const data = model(selected);
    const application = name();
    subtitle.textContent = application;
    if (expand) expand.href = threadUrl();
    newChat.disabled = data.busy;
    form.querySelector('.chat-send').disabled = data.busy || listening;
    mic.disabled = data.busy || listening;
    status.textContent = data.error || (listening ? 'Listening…' : sending && data.busy ? 'LARA is finding an answer…' : '');
    history.innerHTML = data.threads.length ? data.threads.map(thread =>
      `<button type="button" class="chat-thread" data-thread="${escapeHtml(thread.id)}" aria-pressed="${thread.id === data.thread}" ${data.busy ? 'disabled' : ''}>
        ${icon('chat')}<span>${escapeHtml(thread.title)}</span></button>`).join('') : '<p class="chat-history-empty">Your chats will appear here.</p>';
    if (!data.messages.length) {
      log.innerHTML = `<div class="chat-welcome"><div class="chat-welcome-mark">${icon('spark')}</div>
        <h2>${compact ? 'How can I help?' : `Ask me about ${escapeHtml(application)}.`}</h2>
        <p>Ask what you can do, where to find something, or how to complete a task.</p>
        <div class="chat-prompts">${data.suggestions.map(question => `<button type="button" data-question="${escapeHtml(question)}" ${data.busy ? 'disabled' : ''}>${escapeHtml(question)} ${icon('arrow')}</button>`).join('')}</div></div>`;
      return;
    }
    log.innerHTML = `<div class="chat-transcript">${data.messages.map(message =>
      `<article class="chat-message ${message.role === 'user' ? 'from-user' : 'from-lara'}">
      ${message.role === 'user' ? '' : `<div class="chat-message-by"><span class="chat-mini-logo">${icon('spark')}</span> LARA</div>`}
      <div class="chat-message-text">${escapeHtml(message.content)}</div>
      ${message.source ? `<span class="chat-source">${icon('book')} ${escapeHtml(message.source)}</span>` : ''}
      ${message.workflow_title && onWalkthrough ? `<button type="button" class="chat-start-guide" data-guide="${escapeHtml(message.workflow_title)}">${icon('play')} Start walkthrough</button>` : ''}</article>`).join('')}</div>`;
    log.scrollTop = log.scrollHeight;
  }

  const listener = event => { if (event.detail === selected) render(); };
  changes.addEventListener('chat', listener);
  render();
  load(selected);

  async function send(question) {
    const app = selected;
    const data = model(app);
    const message = question.trim();
    if (!message || data.busy) return;
    sending = true;
    data.busy = true;
    data.error = '';
    const draft = { role: 'user', content: message };
    data.messages.push(draft);
    input.value = '';
    notify(app);
    try {
      const result = await api('/api/chat', { app, thread: data.thread, question: message });
      Object.assign(data, result, { ready: true });
      remember(app, data.thread);
    } catch (error) {
      data.messages.pop();
      data.error = error.message;
      if (app === selected && !input.value) input.value = message;
    } finally {
      sending = false;
      data.busy = false;
      notify(app);
    }
  }

  form.addEventListener('submit', event => { event.preventDefault(); send(input.value); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  mic.addEventListener('click', async () => {
    listening = true;
    const app = selected;
    render();
    try {
      const speech = await captureSpeech();
      if (app === selected && input.isConnected) input.value = speech;
    } catch (error) { model(app).error = error.message; } finally {
      listening = false;
      render();
    }
  });
  container.querySelector('select')?.addEventListener('change', event => {
    selected = event.target.value;
    input.value = '';
    onApp?.(selected);
    render();
    load(selected);
  });
  container.addEventListener('click', handleClick);
  async function handleClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const data = model(selected);
    if (button.dataset.guide) return onWalkthrough?.(button.dataset.guide);
    if (data.busy) return;
    if ('new' in button.dataset) {
      Object.assign(data, { thread: null, messages: [], error: '', ready: true });
      remember(selected, null);
      input.value = '';
      notify(selected);
      return input.focus();
    }
    if (button.dataset.question) return send(button.dataset.question);
    if (!button.dataset.thread || button.dataset.thread === data.thread) return;
    const app = selected;
    data.busy = true;
    data.error = '';
    notify(app);
    try {
      data.messages = await api(`/api/chat/thread?app=${encodeURIComponent(app)}&thread=${encodeURIComponent(button.dataset.thread)}`);
      data.thread = button.dataset.thread;
      remember(app, data.thread);
    } catch (error) { data.error = error.message; } finally {
      data.busy = false;
      notify(app);
    }
  }

  return () => { changes.removeEventListener('chat', listener); container.removeEventListener('click', handleClick); };
}

export function mountChatPopup(apps, getApp) {
  const widget = document.createElement('aside');
  widget.className = 'lara-chat-popup';
  widget.setAttribute('aria-label', 'Floating LARA assistant');
  widget.innerHTML = `<div class="lara-popup-panel" id="floating-lara-panel" hidden>
    <header><div>${icon('spark')} <strong>Ask LARA</strong></div><button type="button" aria-label="Minimize LARA">${icon('minus')}</button></header>
    <div class="lara-popup-chat"></div></div>
    <button type="button" class="lara-chat-launcher" aria-expanded="false" aria-controls="floating-lara-panel">${icon('spark')} Ask LARA</button>`;
  document.body.append(widget);
  const panel = widget.querySelector('.lara-popup-panel');
  const launcher = widget.querySelector('.lara-chat-launcher');
  let cleanup;
  let lastContext;
  function toggle(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      const context = getApp?.();
      if (!cleanup || context !== lastContext) {
        cleanup?.();
        cleanup = mountChat(widget.querySelector('.lara-popup-chat'), { apps, appId: context, compact: true });
        lastContext = context;
      }
      panel.querySelector('textarea')?.focus();
    } else launcher.focus();
  }
  launcher.addEventListener('click', () => toggle(panel.hidden));
  panel.querySelector('header button').addEventListener('click', () => toggle(false));
  widget.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) toggle(false); });
  return () => { cleanup?.(); widget.remove(); };
}
