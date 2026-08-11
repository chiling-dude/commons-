// Integration test against a REAL running server + database.
// Run: npm run migrate && MAX_MESSAGES_PER_ROOM=5 npm start (in one terminal),
// then in another: npm run test:integration
//
// (MAX_MESSAGES_PER_ROOM=5 keeps the retention/pagination checks cheap —
// 9 messages instead of hundreds. The default of 500 works fine too, this
// test just sends fewer messages to prove the same behavior faster.)
//
// Uses a throwaway nickname per run so it's safe to re-run repeatedly.

const { io } = require('socket.io-client');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:8080';
const RUN_ID = Date.now().toString(36);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
function authHeader(token) {
  return { Authorization: 'Bearer ' + token };
}
function json(body) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function reportAndAction(modToken, nickname, i) {
  await api('/api/reports', {
    method: 'POST',
    ...json({ roomId: 'global', roomName: 'Global Lobby', nickname, text: `violation ${i}`, reason: 'harassment' }),
    headers: { 'Content-Type': 'application/json', ...authHeader(modToken) },
  });
  const queue = await api('/api/reports/queue', { headers: authHeader(modToken) });
  const target = queue.data.reports.find((r) => r.reported_nickname === nickname && r.status === 'pending');
  const resolved = await api(`/api/reports/${target.id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(modToken) },
    body: JSON.stringify({ outcome: 'actioned' }),
  });
  return resolved.data.status;
}

(async () => {
  console.log(`\nRunning integration tests against ${BASE} (run id: ${RUN_ID})\n`);

  console.log('Auth:');
  const modNick = `mod_${RUN_ID}`;
  const targetNick = `target_${RUN_ID}`;

  const signup = await api('/api/auth/signup', { method: 'POST', ...json({ nickname: modNick, password: 'password123', isAdult: true }) });
  assert(signup.status === 201 && !!signup.data.token, 'signup succeeds and returns a token');

  const dupeSignup = await api('/api/auth/signup', { method: 'POST', ...json({ nickname: modNick, password: 'password123', isAdult: true }) });
  assert(dupeSignup.status === 409, 'duplicate nickname is rejected (409)');

  const wrongLogin = await api('/api/auth/login', { method: 'POST', ...json({ nickname: modNick, password: 'nope' }) });
  assert(wrongLogin.status === 401, 'wrong password is rejected (401)');

  const modToken = signup.data.token;
  await api('/api/auth/signup', { method: 'POST', ...json({ nickname: targetNick, password: 'password123', isAdult: true }) });

  console.log('\nRooms:');
  const rooms = await api('/api/rooms');
  assert(rooms.status === 200 && rooms.data.rooms.length >= 19, 'room list includes all seeded rooms');

  const createRoom = await api('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(modToken) }, body: JSON.stringify({ name: `test-room-${RUN_ID}` }) });
  assert(createRoom.status === 201, 'authenticated room creation succeeds');

  const createRoomNoAuth = await api('/api/rooms', { method: 'POST', ...json({ name: 'nope' }) });
  assert(createRoomNoAuth.status === 401, 'unauthenticated room creation is rejected (401)');

  console.log('\nEscalation (report -> review -> action):');
  const s1 = await reportAndAction(modToken, targetNick, 1);
  assert(s1.stage === 1 && s1.label === 'Warning', '1st violation -> Warning');
  const s2 = await reportAndAction(modToken, targetNick, 2);
  assert(s2.stage === 2 && s2.suspended === true, '2nd violation -> 1 week suspension');
  const s3 = await reportAndAction(modToken, targetNick, 3);
  assert(s3.stage === 3 && s3.suspended === true, '3rd violation -> 1 month suspension');
  const s4 = await reportAndAction(modToken, targetNick, 4);
  assert(s4.stage === 4 && s4.permanent === true, '4th violation -> Permanent restriction');

  const targetLogin = await api('/api/auth/login', { method: 'POST', ...json({ nickname: targetNick, password: 'password123' }) });
  assert(targetLogin.status === 200, 'a permanently-banned account can still log in (deletion is lazy, not immediate)');
  const targetToken = targetLogin.data.token;

  const status = await api('/api/account/status', { headers: authHeader(targetToken) });
  assert(status.data.status?.permanent === true && !status.data.deleted, 'status check confirms permanent but not yet deleted');

  console.log('\nBlocking:');
  await api('/api/account/block', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(modToken) }, body: JSON.stringify({ nickname: targetNick }) });
  const blocked = await api('/api/account/blocked', { headers: authHeader(modToken) });
  assert(blocked.data.blocked.includes(targetNick), 'block is recorded');
  const selfBlock = await api('/api/account/block', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(modToken) }, body: JSON.stringify({ nickname: modNick }) });
  assert(selfBlock.status === 400, 'cannot block yourself');

  console.log('\nReal-time messaging (Socket.IO):');
  const socketA = io(BASE, { auth: { token: modToken } });
  const socketB = io(BASE, { auth: { token: targetToken } });
  await Promise.all([
    new Promise((resolve) => socketA.on('connect', resolve)),
    new Promise((resolve) => socketB.on('connect', resolve)),
  ]);
  socketA.emit('join_room', 'global');
  socketB.emit('join_room', 'global');
  await new Promise((resolve) => setTimeout(resolve, 250));

  const broadcastPromise = new Promise((resolve) => socketB.on('new_message', resolve));
  const sendAck = await new Promise((resolve) => {
    socketA.emit('send_message', { roomId: 'global', text: `hello ${RUN_ID}` }, resolve);
  });
  assert(sendAck?.ok === true, 'unrestricted account can send a message');

  const broadcast = await Promise.race([
    broadcastPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
  ]).catch(() => null);
  assert(broadcast?.message?.text === `hello ${RUN_ID}`, 'message is broadcast in real time to another connected client');

  const bannedAck = await new Promise((resolve) => {
    socketB.emit('send_message', { roomId: 'global', text: 'should be rejected' }, resolve);
  });
  assert(!!bannedAck?.error, 'a permanently-restricted account is rejected server-side when trying to send');

  console.log('\nMessage retention + pagination:');
  const retentionRoom = `retention-test-${RUN_ID}`;
  await api('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(modToken) }, body: JSON.stringify({ name: retentionRoom }) });
  socketA.emit('join_room', retentionRoom);
  await new Promise((resolve) => setTimeout(resolve, 200));

  // MAX_MESSAGES_PER_ROOM must be set to 5 on the SERVER process for this
  // part (see the run instructions at the top of this file) — send 9
  // messages, expect only the most recent 5 to survive the trim.
  // Sends are spaced out to respect the server's own flood guard (600ms
  // minimum between messages per nickname) — this isn't a workaround for a
  // bug, it's respecting a real feature so this test measures retention,
  // not rate limiting.
  let sendFailures = 0;
  for (let i = 1; i <= 9; i++) {
    const ack = await new Promise((resolve) => socketA.emit('send_message', { roomId: retentionRoom, text: `msg ${i}` }, resolve));
    if (ack?.error) sendFailures++;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  assert(sendFailures === 0, 'all 9 messages were accepted by the server (none hit the flood guard)');
  await new Promise((resolve) => setTimeout(resolve, 500)); // let the fire-and-forget trim finish

  const afterTrim = await api(`/api/messages/${retentionRoom}`);
  assert(afterTrim.data.messages.length === 5, `only the 5 most recent messages remain (cap enforced), got ${afterTrim.data.messages.length}`);
  assert(afterTrim.data.messages[4]?.text === 'msg 9', 'the newest message survives the trim');
  assert(afterTrim.data.messages[0]?.text === 'msg 5', 'the oldest surviving message is exactly at the cap boundary');

  const paged = await api(`/api/messages/${retentionRoom}?limit=2&before=${encodeURIComponent(afterTrim.data.messages[0].created_at)}`);
  assert(paged.data.messages.length === 0, 'paginating before the retention boundary correctly returns nothing (trimmed messages are really gone, not just hidden)');

  socketA.close();
  socketB.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Integration test crashed:', err);
  process.exit(1);
});
