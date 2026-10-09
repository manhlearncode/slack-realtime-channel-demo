/* HTTP đọc lịch sử; WebSocket gửi/nhận tin. Không polling để nhận tin mới. */
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const userParam = params.get('user')?.trim();
const user = userParam && userParam.length <= 40 && !/[\p{C}]/u.test(userParam) ? userParam : 'An';
const slug = ['alpha', 'beta'].includes(params.get('channel')) ? params.get('channel') : 'alpha';
const channel = `C_${slug}`;
const messages = new Map();
const pending = new Map();
let socket;
let ready = false;
let syncing = false;
let liveBuffer = [];
let retryTimer;
let reconnectAttempt = 0;
let stopped = false;
let syncVersion = 0;
const MAX_TEXT = 4000;
const draftKey = `teamspace-draft:${channel}:${user}`;

const formatTime = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
const formatDay = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const normalize = (value) => value.toLocaleLowerCase('vi').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
const initials = (value) => {
  const words = value.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words.at(-1)[0] : [...value].slice(0, 2).join('')).toUpperCase();
};
const tone = (value) => [...value].reduce((sum, char) => sum + char.codePointAt(0), 0) % 5;
function clientMessageId() {
  if (typeof crypto.randomUUID === 'function') return `c-${crypto.randomUUID()}`;
  // HTTP qua IP LAN không có randomUUID. getRandomValues vẫn dùng được.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `c-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
function avatar(value) {
  const element = document.createElement('span');
  element.className = `avatar tone-${tone(value)}`;
  element.textContent = initials(value);
  return element;
}
function storage(action, value) {
  try {
    if (action === 'read') return sessionStorage.getItem(draftKey) ?? '';
    if (action === 'write') sessionStorage.setItem(draftKey, value);
  } catch { /* Chế độ chặn storage vẫn sử dụng chat được. */ }
  return '';
}

document.title = `${slug} · Teamspace`;
$('channel-name').textContent = slug;
$('intro-channel').textContent = `#${slug}`;
$('channel-description').textContent = slug === 'alpha' ? 'Kênh trao đổi chung của nhóm' : 'Một kênh riêng để thử trao đổi';
$('message-input').placeholder = `Nhắn tin đến #${slug}`;
$('profile-name').textContent = user;
$('profile-avatar').textContent = initials(user);
$('profile-avatar').className = `avatar tone-${tone(user)}`;
$('message-input').value = storage('read');
for (const link of document.querySelectorAll('[data-channel]')) {
  link.href = `/?${new URLSearchParams({ user, channel: link.dataset.channel })}`;
  link.classList.toggle('active', link.dataset.channel === slug);
  if (link.dataset.channel === slug) link.setAttribute('aria-current', 'page');
}

function updateComposer() {
  const text = $('message-input').value;
  $('character-count').textContent = `${[...text].length} / ${MAX_TEXT}`;
  $('send-button').disabled = !ready || !text.trim() || [...text.trim()].length > MAX_TEXT;
}
function setConnection(state) {
  const label = { connected: 'Đã kết nối', connecting: 'Đang kết nối', offline: 'Mất kết nối' }[state];
  $('connection-status').className = `connection-status ${state}`;
  $('connection-status').querySelector('strong').textContent = label;
  updateComposer();
}
function notice(text = '', error = false) {
  $('notice').hidden = !text;
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
}
function updateSendStatus() {
  $('send-status').textContent = pending.size
    ? `Đang xác nhận ${pending.size} tin nhắn…`
    : ready ? 'Tin nhắn được đồng bộ với cả kênh' : 'Đang chờ kết nối…';
}
function lastId() {
  return Math.max(0, ...messages.keys());
}
function atBottom() {
  const view = $('conversation');
  return view.scrollHeight - view.scrollTop - view.clientHeight < 90;
}
function scrollBottom() {
  $('conversation').scrollTop = $('conversation').scrollHeight;
  $('new-messages').hidden = true;
}

function render(scroll = false) {
  const search = normalize($('search').value.trim());
  const all = [...messages.values()].sort((left, right) => left.id - right.id);
  const filtered = search ? all.filter((message) => normalize(`${message.user} ${message.text}`).includes(search)) : all;
  const fragment = document.createDocumentFragment();
  let day = '';
  for (const message of filtered) {
    const date = new Date(message.created_at);
    const messageDay = formatDay.format(date);
    if (day && day !== messageDay) {
      const divider = document.createElement('li');
      divider.className = 'message-day';
      divider.textContent = messageDay;
      fragment.append(divider);
    }
    day = messageDay;
    const item = document.createElement('li');
    item.className = `message${message.user === user ? ' mine' : ''}`;
    item.dataset.messageId = message.id;
    item.append(avatar(message.user));
    const content = document.createElement('div');
    content.className = 'message-content';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const name = document.createElement('strong');
    name.className = 'message-author';
    name.textContent = message.user;
    const time = document.createElement('time');
    time.dateTime = message.created_at;
    time.title = `${formatDay.format(date)} ${formatTime.format(date)}`;
    time.textContent = formatTime.format(date);
    const text = document.createElement('p');
    text.className = 'message-text';
    // textContent giữ nội dung như <script> ở dạng văn bản.
    text.textContent = message.text;
    meta.append(name, time);
    content.append(meta, text);
    item.append(content);
    fragment.append(item);
  }
  $('messages').replaceChildren(fragment);
  const first = all[0];
  $('day-label').textContent = first ? formatDay.format(new Date(first.created_at)) : 'Hôm nay';
  $('empty-state').hidden = all.length > 0 || !!search;
  $('no-results').hidden = !search || filtered.length > 0;
  $('search-info').hidden = !search;
  $('search-info').textContent = `${filtered.length} tin nhắn phù hợp trong #${slug}`;
  if (scroll) scrollBottom();
}
function merge(items, { forceScroll = false } = {}) {
  const shouldScroll = forceScroll || atBottom();
  let added = false;
  for (const message of items) {
    if (message.channel !== channel || !Number.isSafeInteger(message.id)) continue;
    if (!messages.has(message.id)) added = true;
    messages.set(message.id, message);
  }
  render(shouldScroll);
  if (added && !shouldScroll) $('new-messages').hidden = false;
}
function presence(users) {
  $('online-count').textContent = users.length;
  $('member-label').textContent = `${users.length} trực tuyến`;
  const list = document.createDocumentFragment();
  for (const name of users) {
    const item = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'online-dot';
    const label = document.createElement('span');
    label.textContent = name;
    item.append(dot, label);
    if (name === user) {
      const self = document.createElement('span');
      self.className = 'self-label';
      self.textContent = 'bạn';
      item.append(self);
    }
    list.append(item);
  }
  $('online-users').replaceChildren(list);
  $('member-avatars').replaceChildren(...users.slice(0, 3).map(avatar));
}

async function fetchHistory(after) {
  const suffix = after === undefined ? '' : `?after=${after}`;
  const response = await fetch(`/api/channels/${slug}/messages${suffix}`, {
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Không thể tải lịch sử tin nhắn.');
  const data = await response.json();
  if (!Array.isArray(data.messages)) throw new Error('Dữ liệu lịch sử không hợp lệ.');
  return data.messages;
}
function transmit(entry) {
  if (!ready || socket?.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(entry.event));
    entry.sentAt = Date.now();
  } catch {
    socket.close();
  }
}
function scheduleReconnect() {
  if (stopped || retryTimer) return;
  const wait = Math.min(500 * 2 ** reconnectAttempt++, 5000);
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    connect();
  }, wait);
}
function connect() {
  if (stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  if (!navigator.onLine) {
    ready = false;
    setConnection('offline');
    updateSendStatus();
    scheduleReconnect();
    return;
  }
  const version = ++syncVersion;
  ready = false;
  syncing = true;
  liveBuffer = [];
  setConnection(navigator.onLine ? 'connecting' : 'offline');
  updateSendStatus();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(`${protocol}//${location.host}/ws?${new URLSearchParams({ user, channel })}`);
  socket = current;
  current.addEventListener('open', async () => {
    // Cursor chốt TRƯỚC fetch. Tin WS đến lúc fetch được đệm, tránh bỏ sót tin ở giữa.
    const cursor = lastId();
    try {
      const history = await fetchHistory(cursor);
      if (version !== syncVersion || current.readyState !== WebSocket.OPEN) return;
      merge([...history, ...liveBuffer]);
      liveBuffer = [];
      syncing = false;
      ready = true;
      reconnectAttempt = 0;
      notice();
      setConnection('connected');
      updateSendStatus();
      for (const entry of pending.values()) transmit(entry);
    } catch {
      if (version !== syncVersion) return;
      notice('Chưa đồng bộ được lịch sử. Đang thử kết nối lại…');
      current.close();
    }
  });
  current.addEventListener('message', ({ data }) => {
    if (version !== syncVersion) return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (event.channel && event.channel !== channel) return;
    if (event.type === 'presence') presence(event.users);
    if (event.type === 'message.new') {
      if (syncing) liveBuffer.push(event);
      else merge([event], { forceScroll: event.user === user });
    }
    if (event.type === 'message.ack') {
      pending.delete(event.client_msg_id);
      if (syncing) liveBuffer.push(event.message);
      else merge([event.message], { forceScroll: event.message.user === user });
      updateSendStatus();
    }
    if (event.type === 'error') {
      const failed = pending.get(event.client_msg_id);
      if (event.code === 'SERVER_ERROR') {
        notice('Máy chủ chưa xác nhận được tin nhắn. Đang thử gửi lại…', true);
      } else {
        pending.delete(event.client_msg_id);
        if (failed && !$('message-input').value) {
          $('message-input').value = failed.event.text;
          storage('write', failed.event.text);
        }
        notice(event.message, true);
      }
      updateSendStatus();
      updateComposer();
    }
  });
  current.addEventListener('close', () => {
    if (version !== syncVersion) return;
    ready = false;
    syncing = false;
    presence([]);
    setConnection('offline');
    updateSendStatus();
    notice('Mất kết nối. Hệ thống sẽ tự kết nối lại và lấy các tin nhắn bị lỡ.');
    scheduleReconnect();
  });
  current.addEventListener('error', () => current.close());
}

$('composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('message-input').value.trim();
  if (!ready || !text || [...text].length > MAX_TEXT) return;
  const id = clientMessageId();
  const entry = { event: { type: 'message.send', channel, user, text, client_msg_id: id }, sentAt: 0 };
  pending.set(id, entry);
  transmit(entry);
  $('message-input').value = '';
  storage('write', '');
  notice();
  updateComposer();
  updateSendStatus();
  $('message-input').focus();
});
$('message-input').addEventListener('input', () => {
  storage('write', $('message-input').value);
  updateComposer();
});
$('message-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});
$('search').addEventListener('input', () => render());
$('new-messages').addEventListener('click', scrollBottom);
$('conversation').addEventListener('scroll', () => {
  if (atBottom()) $('new-messages').hidden = true;
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('search').focus();
  }
});
$('change-user').addEventListener('click', () => {
  $('user-input').value = user;
  $('user-error').hidden = true;
  $('user-dialog').showModal();
  $('user-input').select();
});
$('cancel-user').addEventListener('click', () => $('user-dialog').close());
$('user-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('user-input').value.trim();
  if (!name || name.length > 40 || /[\p{C}]/u.test(name)) {
    $('user-error').hidden = false;
    $('user-error').textContent = 'Tên cần từ 1 đến 40 ký tự và không chứa ký tự điều khiển.';
    return;
  }
  location.search = new URLSearchParams({ user: name, channel: slug }).toString();
});
window.addEventListener('offline', () => {
  ready = false;
  setConnection('offline');
  socket?.close();
});
window.addEventListener('online', () => {
  clearTimeout(retryTimer);
  retryTimer = undefined;
  connect();
});
window.addEventListener('pagehide', () => {
  stopped = true;
  clearTimeout(retryTimer);
  socket?.close();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    stopped = false;
    connect();
  }
});
setInterval(() => {
  if (ready) {
    for (const entry of pending.values()) {
      if (Date.now() - entry.sentAt >= 5000) transmit(entry);
    }
  }
}, 1000);

async function boot() {
  updateComposer();
  try {
    // Lần đọc đầu đúng kịch bản: HTTP GET trước, rồi mở WebSocket.
    merge(await fetchHistory(), { forceScroll: true });
  } catch {
    notice('Chưa tải được lịch sử. Đang thử lại qua kết nối mới…');
  }
  connect();
}
boot();
