import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { ChatService } from './chat-service.js';
import { CHANNELS, DemoError, resolveChannel, validUser, validateSend } from './config.js';

const defaultDatabaseUrl = 'postgresql://chatdemo:chatdemo_local@127.0.0.1:5432/chatdemo';

export async function createChatServer({
  databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl,
  pool,
  logger = console,
  heartbeatMs = 15000,
} = {}) {
  const chat = new ChatService({ databaseUrl, pool, logger });
  try {
    await chat.initialize();
  } catch (error) {
    await chat.close();
    throw error;
  }
  const app = express();
  const server = http.createServer(app);
  const servers = new Set([server]);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024, perMessageDeflate: false });
  let closing = false;

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    next();
  });
  app.get('/health', async (request, response) => {
    try {
      await chat.pool.query('SELECT 1');
      response.json({ status: 'ok', database: 'postgresql' });
    } catch {
      response.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });
  app.get('/api/channels', (request, response) => response.json({ channels: CHANNELS }));
  app.get('/api/channels/:channel/messages', async (request, response) => {
    const channel = resolveChannel(request.params.channel);
    if (!channel) throw new DemoError('UNKNOWN_CHANNEL', 'Kênh không tồn tại.', 404);
    const rawAfter = request.query.after ?? '0';
    if (typeof rawAfter !== 'string' || !/^\d+$/.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter))) {
      throw new DemoError('INVALID_CURSOR', 'after phải là ID tin nhắn không âm.');
    }
    const result = await chat.history(channel.id, Number(rawAfter));
    response.set('Cache-Control', 'no-store');
    response.set('X-Cache', result.cache);
    response.json(result);
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { etag: false, maxAge: 0 }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    logger.error(`[HTTP ERROR] ${error.message}`);
    response.status(error.status ?? 503).json({
      error: error.code ?? 'SERVER_ERROR',
      message: error instanceof DemoError ? error.message : 'Không thể đọc dữ liệu. Hãy thử lại.',
    });
  });

  function send(socket, event) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }
  function roomSockets(channel) {
    return [...wss.clients].filter((socket) => socket.channel?.id === channel && socket.readyState === WebSocket.OPEN);
  }
  function broadcast(channel, event) {
    const recipients = roomSockets(channel);
    for (const socket of recipients) send(socket, event);
    return recipients.length;
  }
  function publishPresence(channel) {
    const names = [...new Set(roomSockets(channel).map((socket) => socket.user))].sort();
    broadcast(channel, { type: 'presence', channel, users: names });
  }

  function upgrade(request, socket, head) {
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    const channel = resolveChannel(url.searchParams.get('channel') ?? 'C_alpha');
    const user = url.searchParams.get('user');
    let originMatches = true;
    if (request.headers.origin) {
      try {
        originMatches = new URL(request.headers.origin).host === request.headers.host;
      } catch {
        originMatches = false;
      }
    }
    if (closing || url.pathname !== '/ws' || !channel || !validUser(user) || !originMatches) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (websocket) => {
      websocket.channel = channel;
      websocket.user = user;
      wss.emit('connection', websocket);
    });
  }
  server.on('upgrade', upgrade);

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    logger.log(`[WS CONNECT] channel=${socket.channel.id} user=${socket.user}`);
    send(socket, { type: 'connection.ready', channel: socket.channel.id, user: socket.user });
    publishPresence(socket.channel.id);

    // Promise chain bảo đảm thứ tự event trên cùng kết nối.
    let work = Promise.resolve();
    socket.on('message', (data, isBinary) => {
      work = work.then(async () => {
        let event;
        try {
          if (isBinary) throw new DemoError('INVALID_EVENT', 'Chỉ nhận JSON text frame.');
          try { event = JSON.parse(data.toString()); } catch {
            throw new DemoError('INVALID_JSON', 'Event phải là JSON hợp lệ.');
          }
          const valid = validateSend(event, { channel: socket.channel, user: socket.user });
          const { message, duplicate } = await chat.save(valid);
          if (!duplicate) {
            const recipients = broadcast(valid.channel, { type: 'message.new', ...message });
            logger.log(`[WS BROADCAST] channel=${valid.channel} id=${message.id} recipients=${recipients}`);
          }
          send(socket, { type: 'message.ack', channel: valid.channel, client_msg_id: valid.client_msg_id, duplicate, message });
        } catch (error) {
          logger.error(`[WS ERROR] ${error.message}`);
          send(socket, {
            type: 'error',
            code: error.code ?? 'SERVER_ERROR',
            message: error instanceof DemoError ? error.message : 'Chưa gửi được tin nhắn. Hãy thử lại.',
            client_msg_id: typeof event?.client_msg_id === 'string' ? event.client_msg_id : null,
          });
        }
      }).catch((error) => logger.error(`[WS ERROR] ${error.message}`));
    });
    socket.on('close', () => {
      logger.log(`[WS CLOSE] channel=${socket.channel.id} user=${socket.user}`);
      publishPresence(socket.channel.id);
    });
    socket.on('error', (error) => logger.error(`[WS ERROR] ${error.message}`));
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) socket.terminate();
      else {
        socket.isAlive = false;
        socket.ping();
      }
    }
  }, heartbeatMs);
  heartbeat.unref();

  function listenOn(target, port, host) {
    return new Promise((resolve, reject) => {
      target.once('error', reject);
      target.listen(port, host, () => {
        target.removeListener('error', reject);
        resolve(target.address());
      });
    });
  }

  return {
    app, server, chat,
    listen(port = 3000, host = '127.0.0.1') {
      return listenOn(server, port, host);
    },
    async listenMany(ports, host = '127.0.0.1') {
      if (!Array.isArray(ports) || !ports.length || ports.some((port) => !Number.isInteger(port) || port < 0 || port > 65535)) {
        throw new Error('Danh sách cổng không hợp lệ.');
      }
      const fixedPorts = ports.filter((port) => port !== 0);
      if (new Set(fixedPorts).size !== fixedPorts.length) throw new Error('Các cổng phải khác nhau.');
      const addresses = [];
      for (const [index, port] of ports.entries()) {
        const target = index === 0 ? server : http.createServer(app);
        if (index !== 0) {
          target.on('upgrade', upgrade);
          servers.add(target);
        }
        addresses.push(await listenOn(target, port, host));
      }
      return addresses;
    },
    async close() {
      closing = true;
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
      for (const target of servers) {
        if (target.listening) {
          await new Promise((resolve) => {
            target.close(resolve);
            target.closeIdleConnections();
          });
        }
      }
      await chat.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let instance;
  try {
    const rawPorts = process.env.PORTS?.trim() || process.env.PORT?.trim() || '3001,3002';
    const ports = rawPorts.split(',').map((value) => {
      if (!/^\d+$/.test(value.trim())) throw new Error('PORTS/PORT không hợp lệ.');
      const port = Number(value.trim());
      if (port < 1 || port > 65535) throw new Error('PORTS/PORT phải nằm trong khoảng 1–65535.');
      return port;
    });
    if (new Set(ports).size !== ports.length) throw new Error('Các cổng trong PORTS phải khác nhau.');
    instance = await createChatServer();
    await instance.listenMany(ports, process.env.HOST ?? '127.0.0.1');
    console.log(`[LISTEN] host=${process.env.HOST ?? '127.0.0.1'} ports=${ports.join(',')}`);
    console.log(`[READY] ${process.env.DEMO_AN_URL ?? `http://localhost:${ports[0]}/?user=An`}`);
    console.log(`[READY] ${process.env.DEMO_BINH_URL ?? `http://localhost:${ports[1] ?? ports[0]}/?user=Binh`}`);
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, async () => {
        if (stopping) return;
        stopping = true;
        await instance.close();
        process.exit(0);
      });
    }
  } catch (error) {
    console.error(`[START FAILED] ${error.message}`);
    console.error('Kiểm tra DATABASE_URL, PostgreSQL và các cổng PORTS/PORT. Xem README.md để chạy demo.');
    if (instance) await instance.close();
    process.exit(1);
  }
}
