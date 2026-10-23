const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { getServers } = require('node:dns');
const { validateDnsOptions, runDnsDiagnostics } = require('../dist/dnsDiagnostics');

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const dnsName = n => Buffer.concat([...n.split('.').map(s => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)])), Buffer.from([0])]);
const text = s => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)]);

async function fixture(t) {
  const socket = dgram.createSocket('udp4');
  const seen = [];
  socket.on('message', (msg, peer) => {
    let offset = 12;
    const labels = [];
    while (msg[offset]) { const size = msg[offset++]; labels.push(msg.subarray(offset, offset + size).toString()); offset += size; }
    offset++;
    const name = labels.join('.');
    const type = msg.readUInt16BE(offset);
    const question = msg.subarray(12, offset + 4);
    seen.push({ name, type });
    if (name === 'slow.test') return;
    const code = name === 'missing.test' ? 3 : name === 'error.test' ? 2 : 0;
    let data;
    if (!code && name !== 'empty.test') {
      if (type === 1) data = Buffer.from([192, 0, 2, 1]);
      if (type === 28) data = Buffer.from('20010db8000000000000000000000001', 'hex');
      if (type === 5 && name === 'alias.test') data = dnsName('terminal.test');
      if (type === 5 && name === 'cycle.test') data = dnsName('cycle.test');
      if (type === 5 && /^hop\d+\.test$/.test(name)) data = dnsName(`hop${Number(name.match(/\d+/)[0]) + 1}.test`);
      if (type === 15) data = Buffer.concat([u16(10), dnsName('mail.test')]);
      if (type === 16) data = Buffer.concat([text('hello'), text(' world')]);
      if (type === 2) data = dnsName('ns.test');
      if (type === 6) data = Buffer.concat([dnsName('ns.test'), dnsName('admin.test'), ...[7, 60, 30, 600, 120].map(u32)]);
      if (type === 257) data = Buffer.concat([Buffer.from([0, 5]), Buffer.from('issue'), Buffer.from('ca.test')]);
      if (type === 33) data = Buffer.concat([u16(1), u16(5), u16(443), dnsName('service.test')]);
    }
    const header = Buffer.alloc(12);
    msg.copy(header, 0, 0, 2);
    header.writeUInt16BE(0x8180 | code, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(data ? 1 : 0, 6);
    const answer = data ? Buffer.concat([Buffer.from([0xc0, 0x0c]), u16(type), u16(1), u32(123), u16(data.length), data]) : Buffer.alloc(0);
    socket.send(Buffer.concat([header, question, answer]), peer.port, peer.address);
  });
  await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => socket.close(resolve)));
  return { resolver: `127.0.0.1:${socket.address().port}`, seen };
}

test('DNS options reject invalid values without mutating global resolvers', () => {
  const before = getServers();
  assert.deepEqual(validateDnsOptions().types, ['A', 'AAAA', 'CNAME']);
  for (const input of [{ types: ['ANY'] }, { types: [] }, { types: ['a'] }, { timeoutMs: 99 }, { timeoutMs: 30001 }, { timeoutMs: '1000' }, { resolver: 'example.com' }, { followCname: 'false' }, null]) {
    assert.throws(() => validateDnsOptions(input));
  }
  assert.equal(validateDnsOptions({ resolver: '127.0.0.1:5300' }).resolver, '127.0.0.1:5300');
  for (const resolver of ['127.0.0.1:0', '127.0.0.1:65536', '127.0.0.1:53x', '[::1]:0', '[::1]:65536']) assert.throws(() => validateDnsOptions({ resolver }));
  assert.equal(validateDnsOptions({ resolver: '::1' }).resolver, '::1');
  assert.equal(validateDnsOptions({ resolver: '[::1]:5300' }).resolver, '[::1]:5300');
  assert.deepEqual(getServers(), before);
});

test('DNS records retain known TTL and structured per-type information', async t => {
  const { resolver } = await fixture(t);
  const report = await runDnsDiagnostics('https://Example.test/path', validateDnsOptions({ resolver, types: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV'], followCname: false }));
  assert.equal(report.hostname, 'example.test');
  assert.deepEqual(report.resolvers, [resolver]);
  const records = Object.fromEntries(report.queries.map(q => [q.type, q.records[0]]));
  assert.equal(records.A.ttl, 123);
  assert.equal(records.AAAA.ttl, 123);
  assert.equal(records.TXT.value, 'hello world');
  assert.equal(records.TXT.ttl, undefined);
  assert.equal(records.MX.details.priority, 10);
  assert.equal(records.NS.value, 'ns.test');
  assert.equal(records.SOA.details.serial, 7);
  assert.equal(records.CAA.details.issue, 'ca.test');
  assert.equal(records.SRV.details.port, 443);
  assert.equal(report.queries.find(q => q.type === 'CNAME').status, 'no-data');
});

test('DNS distinguishes no data, NXDOMAIN, resolver failure and timeout', async t => {
  const { resolver } = await fixture(t);
  for (const [name, status] of [['empty.test', 'no-data'], ['missing.test', 'not-found'], ['error.test', 'error'], ['slow.test', 'timeout']]) {
    const report = await runDnsDiagnostics(name, validateDnsOptions({ resolver, types: ['A'], followCname: false, timeoutMs: 100 }));
    assert.equal(report.queries[0].status, status, JSON.stringify(report));
    assert.ok(report.queries[0].durationMs >= 0);
  }
});

test('CNAME follows terminal addresses, reuses queries, detects cycles and limits depth', async t => {
  const { resolver, seen } = await fixture(t);
  const options = validateDnsOptions({ resolver });
  const report = await runDnsDiagnostics('alias.test', options);
  assert.deepEqual(report.cnameChain, ['terminal.test']);
  assert.equal(seen.filter(q => q.name === 'alias.test' && q.type === 5).length, 1);
  assert.ok(report.queries.some(q => q.name === 'terminal.test' && q.type === 'AAAA' && q.status === 'ok'));
  const cycle = await runDnsDiagnostics('cycle.test', options);
  assert.match(cycle.warnings.join(' '), /cycle/);
  const long = await runDnsDiagnostics('hop0.test', options);
  assert.equal(long.cnameChain.length, 8);
  assert.match(long.warnings.join(' '), /8 aliases/);
  const disabled = await runDnsDiagnostics('alias.test', { ...options, followCname: false });
  assert.equal(disabled.cnameChain.length, 0);
  assert.equal(disabled.queries.length, 3);
});

test('DNS cancellation settles in-flight queries and does not follow aliases', async t => {
  const { resolver, seen } = await fixture(t);
  const controller = new AbortController();
  const promise = runDnsDiagnostics('slow.test', validateDnsOptions({ resolver }), controller.signal);
  setTimeout(() => controller.abort(), 30);
  const report = await promise;
  assert.ok(report.queries.every(q => q.status === 'cancelled'));
  assert.equal(report.cnameChain.length, 0);
  const before = seen.length;
  const aborted = await runDnsDiagnostics('alias.test', validateDnsOptions({ resolver }), controller.signal);
  assert.ok(aborted.queries.every(q => q.status === 'cancelled'));
  assert.equal(seen.length, before);
});

test('DNS rejects invalid hostnames before starting queries and accepts service labels', async t => {
  const { resolver } = await fixture(t);
  const options = validateDnsOptions({ resolver, types: ['SRV'], followCname: false });
  for (const name of ['bad;name.test', 'bad/name', 'a..test', '-bad.test', '127.0.0.1', 'https://user:pass@example.test']) await assert.rejects(runDnsDiagnostics(name, options));
  const report = await runDnsDiagnostics('_https._tcp.example.test', options);
  assert.equal(report.queries[0].status, 'ok');
});
