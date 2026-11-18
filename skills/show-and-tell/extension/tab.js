// Placeholder for a new session tab: names the session it belongs to.
const name = new URLSearchParams(location.search).get('n');
if (name) { document.getElementById('name').textContent = name; document.title = name + ' · show-and-tell'; }
