import { mountLara } from '/sdk/ui/wizard.js';

const host = document.querySelector('#host');
const templates = document.querySelector('#host-templates');
const customers = [];
let cartCount = 0;

function render() {
  const route = location.hash.slice(1);
  const template = [...templates.children].find(item => item.dataset.route === route) ?? templates.firstElementChild;
  host.replaceChildren(template.cloneNode(true));
  const list = host.querySelector('.customers');
  if (list) {
    for (const name of customers.length ? customers : ['No customers added in this demo session.']) {
      const entry = document.createElement('li');
      entry.textContent = name;
      list.append(entry);
    }
  }
  document.dispatchEvent(new Event('lara:route'));
}
window.addEventListener('hashchange', render);
render();

function signal(target, message) {
  host.querySelector('.host-message').textContent = message;
  document.dispatchEvent(new CustomEvent('lara:success', { detail: { target } }));
}

host.addEventListener('submit', event => {
  const form = event.target;
  event.preventDefault();
  const target = form.dataset.success;
  if (target === 'save-customer') customers.push(form.elements.customerName.value.trim());
  const messages = { 'create-account': 'Demo account created successfully.', 'lookup-order': 'Order LARA-1001 is out for delivery.', 'save-customer': 'Demo customer saved successfully.' };
  if (messages[target]) signal(target, messages[target]);
  form.reset();
});
host.addEventListener('click', event => {
  const button = event.target.closest('button[data-success]');
  if (button) signal(button.dataset.success, `Added to cart. ${++cartCount} item${cartCount === 1 ? '' : 's'} in your cart.`);
});

mountLara({ app: document.body.dataset.app, appName: document.title.split(' | ')[0], host, navigate: route => {
  if ([...templates.children].some(template => template.dataset.route === route)) location.hash = route;
} });
