import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { WebSocket } from 'ws';
import { createChatServer } from '../src/server.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://chatdemo:chatdemo_local@127.0.0.1:5432/chatdemo';
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const logs = [];
const clients = new Set();
const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
const logger = { log: (line) => logs.push(line), error: (line) => logs.push(line) };
let instance;
let base;
let wsBase;

function pool() {
  return new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
    connectionTimeoutMillis: 5000,
  });
}

async function start() {
  instance = await createChatServer({ pool: pool(), logger });
  const address = await instance.listen(0);
  base = `http://127.0.0.1:${address.port}`;
  wsBase = `ws://127.0.0.1:${address.port}`;
}

async function client(user, channel = 'C_alpha', endpoint = wsBase) {
  const socket = new WebSocket(`${endpoint}/ws?${new URLSearchParams({ user, channel })}`, { origin: endpoint.replace('ws:', 'http:') });
  const inbox = [];
  const waiters = [];
  let upgradeStatus;
  socket.on('upgrade', (response) => { upgradeStatus = response.statusCode; });
  socket.on('message', (bytes) => {
    const event = JSON.parse(bytes.toString());
    const index = waiters.findIndex((waiter) => waiter.predicate(event));
    if (index < 0) inbox.push(event);
    else {
      const waiter = waiters.splice(index, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const result = {
    socket, user, channel, upgradeStatus,
    discardPresence() {
      for (let index = inbox.length - 1; index >= 0; index--) {
        if (inbox[index].type === 'presence') inbox.splice(index, 1);
      }
    },
    next(predicate, timeout = 3000) {
      const index = inbox.findIndex(predicate);
      if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: undefined };
        waiter.timer = setTimeout(() => {
          const position = waiters.indexOf(waiter);
          if (position >= 0) waiters.splice(position, 1);
          reject(new Error('Timed out waiting for WebSocket event'));
        }, timeout);
        waiters.push(waiter);
      });
    },
    send(text, id = `c-${randomUUID()}`) {
      socket.send(JSON.stringify({ type: 'message.send', channel, user, text, client_msg_id: id }));
      return id;
    },
    async close() {
      clients.delete(result);
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolve) => {
        socket.once('close', resolve);
        socket.terminate();
      });
    },
  };
  clients.add(result);
  return result;
}

async function history(channel = 'alpha', after) {
  const response = await fetch(`${base}/api/channels/${channel}/messages${after === undefined ? '' : `?after=${after}`}`);
  assert.equal(response.status, 200);
  return { data: await response.json(), cache: response.headers.get('x-cache') };
}
async function sendAndAck(sender, text, id) {
  const clientId = sender.send(text, id);
  return sender.next((event) => event.type === 'message.ack' && event.client_msg_id === clientId);
}

before(async () => {
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await start();
  } catch (error) {
    throw new Error(`Cần PostgreSQL thật để chạy integration test. Kiểm tra DATABASE_URL hoặc chạy Docker Compose. ${error.message}`);
  }
});
beforeEach(async () => {
  await instance.chat.pool.query('TRUNCATE messages RESTART IDENTITY');
  instance.chat.cache.clear();
  logs.length = 0;
});
afterEach(async () => {
  await Promise.all([...clients].map((item) => item.close()));
});
after(async () => {
  if (instance) await instance.close();
  try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
});

test('HTTP lần đầu CACHE MISS, lần kế tiếp CACHE HIT', async () => {
  const first = await history();
  const second = await history();
  assert.equal(first.cache, 'MISS');
  assert.equal(first.data.cache, 'MISS');
  assert.equal(second.cache, 'HIT');
  assert.deepEqual(second.data.messages, []);
  assert.ok(logs.some((line) => line.startsWith('[CACHE MISS]')));
  assert.ok(logs.some((line) => line.startsWith('[CACHE HIT]')));
});

test('An và Binh trao đổi realtime; DB → Cache → broadcast; beta không nhận tin alpha', async () => {
  await history();
  const an = await client('An');
  const binh = await client('Binh');
  const beta = await client('Khach', 'C_beta');
  assert.equal(an.upgradeStatus, 101);
  assert.equal(binh.upgradeStatus, 101);
  const id = an.send('Chào cả nhóm!');
  const [ack, received] = await Promise.all([
    an.next((event) => event.type === 'message.ack' && event.client_msg_id === id),
    binh.next((event) => event.type === 'message.new' && event.client_msg_id === id),
  ]);
  assert.equal(ack.message.id, received.id);
  assert.equal(received.user, 'An');
  assert.equal(received.text, 'Chào cả nhóm!');
  assert.match(received.ts, /^\d+\.\d{6}$/);
  assert.equal(received.channel, 'C_alpha');
  const reply = await sendAndAck(binh, 'Đã nhận!');
  const replied = await an.next((event) => event.type === 'message.new' && event.id === reply.message.id);
  assert.equal(replied.user, 'Binh');
  await assert.rejects(beta.next((event) => event.type === 'message.new', 200), /Timed out/);
  const db = await instance.chat.pool.query('SELECT text FROM messages ORDER BY id');
  assert.deepEqual(db.rows.map((row) => row.text), ['Chào cả nhóm!', 'Đã nhận!']);
  const insertIndex = logs.findIndex((line) => line.startsWith('[DB INSERT]'));
  const cacheIndex = logs.findIndex((line) => line.startsWith('[CACHE UPDATE]'));
  const broadcastIndex = logs.findIndex((line) => line.startsWith('[WS BROADCAST]'));
  assert.ok(insertIndex >= 0 && insertIndex < cacheIndex && cacheIndex < broadcastIndex);
});

test('Đọc lại lịch sử tương đương F5 dùng cache và còn đủ tin đã lưu', async () => {
  const an = await client('An');
  await sendAndAck(an, 'Tin được lưu');
  const reloaded = await history();
  assert.equal(reloaded.cache, 'HIT');
  assert.equal(reloaded.data.messages.length, 1);
  assert.equal(reloaded.data.messages[0].text, 'Tin được lưu');
});

test('Gửi lại cùng client_msg_id chỉ lưu và broadcast một tin', async () => {
  const an = await client('An');
  const binh = await client('Binh');
  const id = `c-${randomUUID()}`;
  const first = await sendAndAck(an, 'Chỉ lưu một lần', id);
  const second = await sendAndAck(an, 'Chỉ lưu một lần', id);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.message.id, second.message.id);
  await binh.next((event) => event.type === 'message.new');
  await assert.rejects(binh.next((event) => event.type === 'message.new', 200), /Timed out/);
  assert.equal((await history()).data.messages.length, 1);
});

test('Kết nối lại và HTTP after lấy đủ tin nhắn bị lỡ', async () => {
  const an = await client('An');
  const binh = await client('Binh');
  const old = await sendAndAck(an, 'Tin trước khi mất mạng');
  await binh.close();
  const missed1 = await sendAndAck(an, 'Tin khi Binh mất mạng 1');
  const missed2 = await sendAndAck(an, 'Tin khi Binh mất mạng 2');
  await client('Binh');
  const sync = await history('alpha', old.message.id);
  assert.deepEqual(sync.data.messages.map((message) => message.id), [missed1.message.id, missed2.message.id]);
});

test('Đọc/ghi đồng thời không làm mất tin trong Map cache', async () => {
  const senders = await Promise.all([client('An'), client('Binh')]);
  await Promise.all(Array.from({ length: 24 }, async (_, index) => {
    if (index % 3 === 0) await history();
    return sendAndAck(senders[index % 2], `Tin đồng thời ${index}`, `concurrent-${index}`);
  }));
  const cached = await history();
  const saved = await instance.chat.pool.query('SELECT id, text FROM messages ORDER BY id');
  assert.equal(saved.rowCount, 24);
  assert.deepEqual(cached.data.messages.map(({ id, text }) => ({ id, text })), saved.rows);
});

test('Ghi khi cache rỗng nạp lại cả lịch sử cũ', async () => {
  const an = await client('An');
  await sendAndAck(an, 'Tin cũ');
  instance.chat.cache.clear();
  await sendAndAck(an, 'Tin mới');
  assert.deepEqual((await history()).data.messages.map((message) => message.text), ['Tin cũ', 'Tin mới']);
});

test('JSON lỗi, giả người gửi, sai kênh, tin rỗng và tin quá dài không được lưu', async () => {
  const an = await client('An');
  const baseEvent = { type: 'message.send', channel: 'C_alpha', user: 'An', text: 'hello', client_msg_id: 'bad-test' };
  const invalid = [
    ['{', 'INVALID_JSON'],
    [JSON.stringify({ ...baseEvent, user: 'Binh' }), 'INVALID_IDENTITY'],
    [JSON.stringify({ ...baseEvent, channel: 'C_beta' }), 'INVALID_IDENTITY'],
    [JSON.stringify({ ...baseEvent, text: '   ' }), 'INVALID_TEXT'],
    [JSON.stringify({ ...baseEvent, text: 'a'.repeat(4001) }), 'INVALID_TEXT'],
    [JSON.stringify({ ...baseEvent, client_msg_id: '<invalid>' }), 'INVALID_CLIENT_ID'],
  ];
  for (const [data, code] of invalid) {
    an.socket.send(data);
    const error = await an.next((event) => event.type === 'error');
    assert.equal(error.code, code);
  }
  assert.equal((await history()).data.messages.length, 0);
  assert.equal(an.socket.readyState, WebSocket.OPEN);
});

test('API từ chối kênh không tồn tại và cursor không hợp lệ', async () => {
  assert.equal((await fetch(`${base}/api/channels/unknown/messages`)).status, 404);
  for (const after of ['-1', 'abc', '9007199254740992']) {
    assert.equal((await fetch(`${base}/api/channels/alpha/messages?after=${after}`)).status, 400);
  }
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('Presence đếm theo tên trong kênh, hai tab An chỉ hiện một thành viên', async () => {
  const an1 = await client('An');
  const an2 = await client('An');
  const binh = await client('Binh');
  const presence = await binh.next((event) => event.type === 'presence' && event.users.length === 2);
  assert.deepEqual(presence.users, ['An', 'Binh']);
  await an2.close();
  const unchanged = await binh.next((event) => event.type === 'presence' && event.users.length === 2);
  assert.deepEqual(unchanged.users, ['An', 'Binh']);
  an1.discardPresence();
  await binh.close();
  const remaining = await an1.next((event) => event.type === 'presence' && event.users.length === 1);
  assert.deepEqual(remaining.users, ['An']);
});

test('Khởi động lại server xóa Map nhưng PostgreSQL vẫn giữ lịch sử', async () => {
  const an = await client('An');
  await sendAndAck(an, 'Tin vẫn còn sau restart');
  await an.close();
  await instance.close();
  await start();
  const restored = await history();
  assert.equal(restored.cache, 'MISS');
  assert.equal(restored.data.messages[0].text, 'Tin vẫn còn sau restart');
});

test('Hai cổng chia sẻ cache, socket trong kênh và lịch sử; dừng server đóng cả hai cổng', async () => {
  await instance.close();
  instance = await createChatServer({ pool: pool(), logger });
  const [first, second] = await instance.listenMany([0, 0]);
  assert.notEqual(first.port, second.port);
  base = `http://127.0.0.1:${first.port}`;
  wsBase = `ws://127.0.0.1:${first.port}`;
  const secondBase = `http://127.0.0.1:${second.port}`;
  assert.equal((await history()).cache, 'MISS');
  const secondHistory = await fetch(`${secondBase}/api/channels/alpha/messages`);
  assert.equal(secondHistory.headers.get('x-cache'), 'HIT');
  const an = await client('An');
  const binh = await client('Binh', 'C_alpha', `ws://127.0.0.1:${second.port}`);
  assert.equal(an.upgradeStatus, 101);
  assert.equal(binh.upgradeStatus, 101);
  const greeting = await sendAndAck(an, 'An gửi từ cổng thứ nhất');
  assert.equal((await binh.next((event) => event.type === 'message.new')).id, greeting.message.id);
  const reply = await sendAndAck(binh, 'Binh gửi từ cổng thứ hai');
  assert.equal((await an.next((event) => event.type === 'message.new' && event.id === reply.message.id)).user, 'Binh');
  const saved = await fetch(`${secondBase}/api/channels/alpha/messages`).then((response) => response.json());
  assert.deepEqual(saved.messages.map((message) => message.text), ['An gửi từ cổng thứ nhất', 'Binh gửi từ cổng thứ hai']);
  await Promise.all([an.close(), binh.close()]);
  await instance.close();
  await assert.rejects(fetch(`${base}/health`));
  await assert.rejects(fetch(`${secondBase}/health`));
  await start();
});
