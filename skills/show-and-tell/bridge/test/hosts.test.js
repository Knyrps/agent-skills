// Which hosts the shared browser may be used on: this machine always, the rest only with the user's grant.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHosts, loopbackNames } from '../hosts.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sat-hosts-'));
const hostsFile = path.join(dir, 'hosts');
fs.writeFileSync(hostsFile, [
  '# comment 127.0.0.1 commented.test',
  '127.0.0.1   app.dev.local  www.shop.example   # local copy of a real site',
  '::1 v6.dev.local',
  '172.17.5.92 grafana.remote.zz',
].join('\n'));
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ allowlist: ['*.team.test'] }));
const hosts = createHosts({ extDir: dir, hostsFile });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('the hosts file counts only for names it points at loopback', () => {
  assert.deepEqual(loopbackNames(fs.readFileSync(hostsFile, 'utf8')), ['app.dev.local', 'v6.dev.local', 'www.shop.example']);
  assert.equal(hosts.check('https://app.dev.local/x').ok, true);
  assert.equal(hosts.check('https://www.shop.example/').ok, true);
  assert.equal(hosts.check('https://shop.example/').ok, false, 'an exact name, not the whole domain');
  assert.equal(hosts.check('http://grafana.remote.zz:3000/').ok, false, 'private but not this machine');
});

test('loopback, config patterns and blank pages are allowed; other schemes are not', () => {
  for (const u of ['http://localhost:3000/', 'http://127.0.0.5/', 'http://[::1]:8080/', 'http://api.localhost/', 'https://a.team.test/', 'about:blank'])
    assert.equal(hosts.check(u).ok, true, u);
  assert.equal(hosts.check('file:///C:/x').ok, false);
  assert.equal(hosts.check('chrome://settings').ok, false);
});

test('a session grant lives in memory; "always" is appended to config.local.json', () => {
  hosts.grant('grafana.remote.zz', 'session');
  assert.equal(hosts.check('http://grafana.remote.zz:3000/').reason, 'this session');
  assert.equal(fs.existsSync(path.join(dir, 'config.local.json')), false);
  fs.writeFileSync(path.join(dir, 'config.local.json'), JSON.stringify({ branding: { name: 'X' } }));
  hosts.grant('Logs.Remote.zz', 'always');
  hosts.grant('logs.remote.zz', 'always');
  const local = JSON.parse(fs.readFileSync(path.join(dir, 'config.local.json'), 'utf8'));
  assert.deepEqual(local, { branding: { name: 'X' }, allowlist: ['logs.remote.zz'] });
  assert.deepEqual(hosts.state().allow, ['*.team.test', 'logs.remote.zz']);
  assert.throws(() => hosts.grant('evil.zz/../x', 'always'));
});

test('hosts-file edits are picked up without a restart', () => {
  fs.appendFileSync(hostsFile, '\n127.0.0.1 new.dev.local\n');
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(hostsFile, t, t);
  assert.equal(hosts.check('http://new.dev.local/').ok, true);
});
