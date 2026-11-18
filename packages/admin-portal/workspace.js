import { icon } from '/sdk/ui/icons.js';
import { escapeHtml as esc } from '/sdk/ui/chat.js';

export const label = value => String(value ?? '').replace(/(^|-)(\w)/g, (_, start, letter) => (start ? ' ' : '') + letter.toUpperCase());
export const date = value => value ? new Intl.DateTimeFormat(undefined,
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';
export const pill = value => `<span class="pill ${esc(value)}">${esc(label(value))}</span>`;
export const button = (text, symbol, type = 'outline', attrs = '') =>
  `<button class="btn ${type}" type="button" ${attrs}>${icon(symbol)}${text}</button>`;
export const link = (text, symbol, href, type = 'outline') =>
  `<a class="btn ${type}" href="${esc(href)}">${icon(symbol)}${text}</a>`;
export const appUrl = (app, tab = 'details') => `#demo/${encodeURIComponent(app)}/${tab}`;

export const tabs = {
  details: ['Details', 'apps'],
  knowledge: ['Knowledge base', 'book'],
  workflows: ['Workflows', 'workflow'],
  sessions: ['Guidance sessions', 'sessions'],
  activity: ['Recent activity', 'clock']
};

const empty = message => `<p class="empty">${message}</p>`;
const cardHeader = (name, detail) => `<header class="card-header"><h2>${name}</h2><p>${detail}</p></header>`;
const table = (columns, rows) => `<div class="table-wrap"><table><thead><tr>${columns.map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

export function applicationDirectory(apps) {
  return `<div class="page-heading"><div><h1>DEMO Application</h1><p>Open a registered application to see its knowledge and guidance.</p></div>
    ${button('Register application', 'plus', 'primary', 'data-register')}</div>
    <div class="app-grid">${apps.map((app, index) => `<article class="app-card card">
      <div class="app-card-top"><span class="tile ${index % 2 ? 'ice' : ''}">${icon(index % 2 ? 'layers' : 'apps')}</span><span class="app-kind">${app.built_in ? 'Demo host' : 'Registered host'}</span></div>
      <h2>${esc(app.name)}</h2><p>${esc(app.built_in ? (app.id === 'demo-shop' ? 'Sample storefront and checkout tasks.' : 'Sample customer directory and contact management.') : app.url)}</p>
      <div class="app-card-actions">${link('View application', 'arrow', appUrl(app.id), 'flat')}${link('Open host', 'external', app.url, 'outline')}</div>
    </article>`).join('')}</div>`;
}

function details({ app, routes, knowledge, workflows, runs }) {
  const last = runs[0];
  const counts = [
    ['layers', routes.length, 'Analyzed screens'],
    ['target', routes.reduce((sum, route) => sum + route.targets.length, 0), 'Annotated controls'],
    ['workflow', workflows.filter(item => item.status === 'published').length, 'Published workflows'],
    ['chat', (knowledge.answers ?? []).length, 'Documented answers']
  ];
  return `<div class="app-counts">${counts.map(([symbol, total, text]) => `<div class="card count"><span class="tile">${icon(symbol)}</span><div><strong>${total}</strong><p>${text}</p></div></div>`).join('')}</div>
    <div class="detail-grid"><section class="card inset"><h2>Application profile</h2><p>${esc(knowledge.description || 'Import annotated source to add an application description and teach LARA about this app.')}</p>
      <dl><div><dt>Application ID</dt><dd><code>${esc(app.id)}</code></dd></div><div><dt>Host URL</dt><dd><a href="${esc(app.url)}">${esc(app.built_in ? location.origin + app.url : app.url)}</a></dd></div>
        <div><dt>Registered</dt><dd>${date(app.created)}</dd></div><div><dt>SDK</dt><dd>${app.built_in ? 'Embedded in host' : 'Available for integration'}</dd></div></dl></section>
    <section class="card inset"><h2>Source analysis</h2><p>${last ? 'Review the detected screens, controls and documented answers.' : 'Upload an annotated HTML file to extract screens, controls and workflow candidates.'}</p>
      <dl><div><dt>Source</dt><dd>${app.built_in ? 'Bundled HTML' : 'HTML import'}</dd></div><div><dt>Last analyzed</dt><dd>${date(last?.analyzed)}</dd></div></dl>
      <div class="actions">${app.built_in ? button('Analyze source', 'scan', 'outline', `data-analyze="${esc(app.id)}"`) :
        button('Import source', 'scan', 'primary', `data-import="${esc(app.id)}"`)}
      ${last ? link('View knowledge', 'arrow', appUrl(app.id, 'knowledge'), 'flat') : ''}</div></section></div>`;
}

function knowledge({ routes, knowledge, runs }) {
  return `<section class="card">${cardHeader('Screen map', 'Routes, annotated UI elements, and links extracted from the latest analysis.')}
    ${routes.length ? `<div class="route-list">${routes.map(route => {
      const controls = route.controls ?? route.targets.map(id => ({ id, label: id, type: 'control' }));
      return `<details class="route"><summary>${icon('layers')}<strong>${esc(route.title ?? route.route)}</strong><code>${esc(route.route)}</code><span>${controls.length} controls</span>${icon('chevron')}</summary>
        ${controls.length ? table(['Control', 'Stable ID', 'Element', 'Links to'], controls.map(control =>
          `<tr><td>${esc(control.label)}</td><td><code>${esc(control.id)}</code></td><td>${esc(control.type)}</td><td>${esc(control.destination ?? '—')}</td></tr>`)) : empty('No annotated controls on this screen.')}</details>`;
    }).join('')}</div>` : empty('Analyze source to build a screen map.')}</section>
    <section class="card">${cardHeader('Documented answers', 'Questions LARA can answer from this application’s knowledge annotation.')}
    ${knowledge.answers?.length ? `<div class="faq-list">${knowledge.answers.map(item =>
      `<details><summary>${esc(item.question)}${icon('chevron')}</summary><p>${esc(item.answer)}</p></details>`).join('')}</div>` : empty('No answers have been documented for this application.')}</section>
    <section class="card">${cardHeader('Analysis runs', 'Source fingerprints and extraction results for this application.')}
    ${runs.length ? table(['Analyzed', 'Source fingerprint', 'Screens', 'Workflows'], runs.map(run =>
      `<tr><td>${date(run.analyzed)}</td><td><code title="${esc(run.source_hash)}">${esc(run.source_hash.slice(0, 12))}</code></td><td>${run.route_count}</td><td>${run.workflow_count}</td></tr>`)) : empty('No analysis runs yet.')}</section>`;
}

export function workflowTable(workflows) {
  return workflows.length ? table(['Workflow', 'Status', 'Verification', 'Steps'], workflows.map(item => `<tr>
    <td><button class="text-button" data-workflow="${esc(item.id)}">${esc(item.title)}</button><small>Version ${item.version}</small></td>
    <td>${pill(item.status)}</td><td>${pill(item.verification.valid ? 'verified' : 'needs-review')}</td><td>${item.steps.length}</td></tr>`)) :
    empty('No workflows match this view.');
}

function workflowPanel({ workflows }) {
  return `<section class="card">${cardHeader('Workflow library', 'Inspect each workflow’s steps and source verification before publishing.')}
    <div class="filter"><input type="search" id="search" aria-label="Search workflows" placeholder="Search workflows…">
    <select id="status" aria-label="Workflow status"><option value="">All statuses</option>${['published', 'approved', 'under-review', 'archived'].map(status => `<option value="${status}">${label(status)}</option>`).join('')}</select></div>
    <div id="workflow-table">${workflowTable(workflows)}</div></section>`;
}

function sessions({ sessions }) {
  return `<section class="card">${cardHeader('Session history', 'Walkthrough outcomes and progress for this application.')}
  ${sessions.length ? table(['Workflow', 'Status', 'Progress', 'Input', 'Rejected actions', 'Started'], sessions.map(item => `<tr>
    <td><strong>${esc(item.title)}</strong></td><td>${pill(item.status)}</td><td>${item.step_index} / ${item.total}</td>
    <td>${esc(label(item.input_type))}</td><td>${item.rejected}</td><td>${date(item.started)}</td></tr>`)) : empty('No guidance sessions for this application yet.')}</section>`;
}

function activity({ activity }) {
  return `<section class="card">${cardHeader('Activity log', 'Source analysis, workflow changes, and walkthrough outcomes for this application.')}
    ${activity.length ? `<ul class="app-activity">${activity.map(item => `<li><span class="tile">${icon(item.icon)}</span>
      <div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div><time datetime="${esc(item.created)}">${date(item.created)}</time></li>`).join('')}</ul>` :
      empty('There is no recorded activity for this application yet.')}</section>`;
}

const panels = { details, knowledge, workflows: workflowPanel, sessions, activity };
export function applicationWorkspace(info, tab) {
  const { app } = info;
  return `<a class="back-link" href="#demo">← All applications</a>
    <div class="page-heading app-heading"><div class="app-heading-title"><span class="tile">${icon('apps')}</span><div><h1>${esc(app.name)}</h1>
      <p>${esc(app.built_in ? location.origin + app.url : app.url)}</p></div></div><div class="actions">
      ${link('Open host', 'external', app.url)}${link('Chat about this app', 'chat', `#conversations/${encodeURIComponent(app.id)}`, 'primary')}</div></div>
    <nav class="app-tabs" aria-label="${esc(app.name)} sections">${Object.entries(tabs).map(([id, [text, symbol]]) =>
      `<a href="${appUrl(app.id, id)}" ${id === tab ? 'aria-current="page"' : ''}>${icon(symbol)}${text}</a>`).join('')}</nav>
    <div class="panel-stack">${panels[tab](info)}</div>`;
}
