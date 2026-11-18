import { icon } from '/sdk/ui/icons.js';
import { api, escapeHtml as esc, mountChat, mountChatPopup } from '/sdk/ui/chat.js';
import { appUrl, applicationDirectory, applicationWorkspace, button, link, tabs, workflowTable, label, pill } from './workspace.js';

const root = document.querySelector('#workspace');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
let applications = [];
let info;
let cleanupChat;
let cleanupPopup;
let chatContext;
let revision = 0;
let toastTimer;
let returnFocus;

const navLink = (title, symbol, href, selected) =>
  `<a class="nav-link" href="${href}" ${selected ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span></a>`;

function getRoute() {
  const [view, second, third] = location.hash.slice(1).split('/');
  if (view === 'conversations') return { view, app: second };
  if (view === 'demo' || view === 'applications') return { view: 'demo', app: second, tab: Object.hasOwn(tabs, third) ? third : 'details' };
  return { view: 'overview' };
}

function overview() {
  return `<section class="overview-hero">
    <div class="orbit-art" aria-hidden="true"></div>
    <div class="hero-copy"><div class="hero-kicker">${icon('spark')} Your in-app AI assistant</div>
      <h1>Meet LARA<span>.</span></h1>
      <p>Ask a question about your application. Get a clear answer, find the right screen, or follow a step-by-step walkthrough.</p>
      <div class="actions">${link('Start a conversation', 'chat', '#conversations', 'hero-primary')}
      ${link('Explore the demo', 'arrow', '#demo', 'hero-secondary')}</div></div>
  </section>
  <section class="about-lara" aria-labelledby="about-lara-title">
    <div class="section-intro"><h2 id="about-lara-title">What LARA can do</h2><p>Get help while you work, with answers that use the application you’ve chosen.</p></div>
    <div class="feature-grid">
      <article class="feature card"><span class="tile">${icon('chat')}</span><h3>Answer in chat</h3><p>Ask how a feature works or where to find it. Pick up past conversations whenever you need them.</p></article>
      <article class="feature card"><span class="tile ice">${icon('target')}</span><h3>Guide you on screen</h3><p>Start a published walkthrough to highlight the relevant controls and verify your progress.</p></article>
      <article class="feature card"><span class="tile">${icon('book')}</span><h3>Use your app’s knowledge</h3><p>LARA draws on analyzed screens, documented answers, and approved workflows for each application.</p></article>
    </div>
  </section>`;
}

function shell(path, content) {
  const name = { overview: 'Overview', conversations: 'Conversations', demo: 'DEMO Application' }[path.view];
  return `<div class="shell"><aside class="sidebar">
    <a class="brand" href="#overview"><span class="brand-icon">${icon('spark')}</span><span>LARA<small>In-app AI assistant</small></span></a>
    <nav class="nav-primary" aria-label="Workspace">${navLink('Overview', 'home', '#overview', path.view === 'overview')}${navLink('Conversations', 'chat', '#conversations', path.view === 'conversations')}</nav>
    <div class="sidebar-bottom"><nav aria-label="Applications">${navLink('DEMO Application', 'apps', '#demo', path.view === 'demo')}</nav>
    <div class="account"><span class="avatar">TS</span><span><strong>Team Slytherin</strong><small>Local workspace</small></span></div></div>
    </aside><div class="main-shell"><header class="topbar"><div class="crumb"><span>Workspace</span>${icon('chevron')}<strong>${name}</strong></div>
      <a class="top-chat" href="#conversations">${icon('chat')} <span>AI assistant</span></a>
    </header><main class="content ${path.view === 'conversations' ? 'conversation-content' : ''}">${content}</main></div></div>`;
}

function paint(path, content) {
  cleanupChat?.();
  cleanupChat = undefined;
  root.innerHTML = shell(path, content);
  const tab = root.querySelector('.app-tabs [aria-current]');
  if (tab && tab.offsetLeft + tab.offsetWidth > tab.parentElement.clientWidth) {
    tab.parentElement.scrollLeft = tab.offsetLeft - 10;
  }
}

async function show() {
  const current = ++revision;
  const path = getRoute();
  info = null;
  if (path.view === 'overview') {
    paint(path, overview());
    return;
  }
  if (path.view === 'conversations') {
    paint(path, `<div class="page-heading"><div><h1>Conversations</h1><p>Ask LARA about a registered application.</p></div></div><div id="full-chat"></div>`);
    chatContext = applications.some(app => app.id === path.app) ? path.app : chatContext;
    cleanupChat = mountChat(root.querySelector('#full-chat'), { apps: applications, appId: chatContext, onApp: id => {
      chatContext = id;
      history.replaceState(null, '', `#conversations/${encodeURIComponent(id)}`);
    } });
    return;
  }
  if (!path.app) {
    paint(path, applicationDirectory(applications));
    return;
  }
  const previous = root.querySelector('.app-heading');
  if (!previous) paint(path, '<p class="empty" role="status">Loading application…</p>');
  try {
    const result = await api(`/api/application?app=${encodeURIComponent(path.app)}`);
    if (current !== revision) return;
    info = result;
    paint(path, applicationWorkspace(result, path.tab));
  } catch (error) {
    if (current === revision) paint(path, `<a class="back-link" href="#demo">← All applications</a><p class="empty">${esc(error.message)}</p>`);
  }
}

function showToast(message) {
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 4500);
}

function openDialog(content, source) {
  returnFocus = source;
  dialog.innerHTML = content;
  dialog.showModal();
}
dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); });

const formError = '<p class="form-error" role="alert" hidden></p>';
function register(source) {
  openDialog(`<h2 id="dialog-title">Register application</h2><p>Add a host to the workspace. You can import its source after registration.</p>
    <form id="register-form"><label>Application name<input name="name" maxlength="80" required autofocus></label>
      <label>Base URL<input name="url" type="url" placeholder="https://app.example.com" required></label>
      ${formError}<div class="actions"><button class="btn primary">Register application</button>${button('Cancel', 'close', 'outline', 'data-close')}</div></form>`, source);
}

function importSource(app, source) {
  openDialog(`<h2 id="dialog-title">Import application source</h2><p>Choose an annotated HTML file for ${esc(app.name)}.</p>
    <form id="source-form" data-app="${esc(app.id)}"><label>HTML file<input name="source" type="file" accept=".html,.htm,text/html" required></label>
      ${formError}<div class="actions"><button class="btn primary">Analyze source</button>${button('Cancel', 'close', 'outline', 'data-close')}</div></form>`, source);
}

function workflowDetails(item, source) {
  const next = { 'under-review': ['Approve workflow', 'approved'], approved: ['Publish workflow', 'published'],
    published: ['Return to review', 'under-review'] }[item.status];
  const action = next && (item.verification.valid || next[1] === 'under-review')
    ? button(next[0], 'check', 'primary', `data-id="${esc(item.id)}" data-next="${next[1]}"`) : '';
  openDialog(`<h2 id="dialog-title">${esc(item.title)}</h2><p>Version ${item.version} · ${pill(item.status)}</p>
    <p>${item.verification.valid ? 'All annotated targets passed source validation.' : esc(item.verification.issues.join(' '))}</p>
    <ol class="step-list">${item.steps.map(step => `<li>${esc(step.instruction)}<small>${esc(step.route)} / ${esc(step.target)} · ${esc(label(step.action))}</small></li>`).join('')}</ol>
    ${formError}<div class="actions">${action}${button('Close', 'close', 'outline', 'data-close')}</div>`, source);
}

function renderFiltered() {
  const list = root.querySelector('#workflow-table');
  const search = root.querySelector('#search')?.value.toLowerCase().trim();
  const status = root.querySelector('#status')?.value;
  if (list && info) list.innerHTML = workflowTable(info.workflows.filter(item =>
    (!status || item.status === status) && item.title.toLowerCase().includes(search)));
}

function displayError(error) {
  const region = dialog.open && dialog.querySelector('.form-error');
  if (region) { region.hidden = false; region.textContent = error.message; }
  else showToast(error.message);
}

async function loadApps() {
  applications = await api('/api/applications');
  cleanupPopup?.();
  cleanupPopup = mountChatPopup(applications, () => getRoute().app ?? chatContext);
}

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  show();
});
window.addEventListener('pageshow', event => { if (event.persisted) show(); });
root.addEventListener('input', event => { if (event.target.matches('#search, #status')) renderFiltered(); });
document.addEventListener('click', async event => {
  const control = event.target.closest('button');
  if (!control) return;
  if ('close' in control.dataset) return dialog.close();
  if ('register' in control.dataset) return register(control);
  if (control.dataset.import && info) return importSource(info.app, control);
  if (control.dataset.workflow && info) return workflowDetails(info.workflows.find(item => item.id === control.dataset.workflow), control);
  if (!control.dataset.analyze && !control.dataset.next) return;
  control.disabled = true;
  try {
    if (control.dataset.analyze) {
      const result = await api('/api/analyze', { id: control.dataset.analyze });
      showToast(`Analyzed ${result.routes} screens and ${result.workflows} workflows.`);
    } else {
      await api('/api/workflows/status', { id: control.dataset.id, status: control.dataset.next });
      dialog.close();
      showToast(`Workflow is now ${label(control.dataset.next).toLowerCase()}.`);
    }
    await show();
  } catch (error) { displayError(error); } finally { control.disabled = false; }
});

dialog.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button:not([type])');
  submit.disabled = true;
  form.querySelector('.form-error').hidden = true;
  try {
    if (form.id === 'source-form') {
      const file = form.elements.source.files[0];
      if (!file || file.size > 1024 * 1024) throw new Error('Choose an annotated HTML file up to 1 MB.');
      const result = await api('/api/analyze', { id: form.dataset.app, source: await file.text() });
      dialog.close();
      showToast(`Analyzed ${result.routes} screens and ${result.workflows} workflows.`);
      await show();
    } else {
      const result = await api('/api/applications', Object.fromEntries(new FormData(form)));
      dialog.close();
      showToast('Application registered.');
      await loadApps();
      location.hash = appUrl(result.id);
    }
  } catch (error) { displayError(error); } finally { submit.disabled = false; }
});

const initialRoute = getRoute();
if (initialRoute.view === 'overview') show();
else paint(initialRoute, '<p class="empty" role="status">Loading LARA…</p>');
loadApps().then(() => { if (getRoute().view !== 'overview') show(); }).catch(error => showToast(error.message));
