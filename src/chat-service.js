import { readFile } from 'node:fs/promises';
import pg from 'pg';

const fields = `id, channel_id AS channel, "user", text, client_msg_id, created_at, ts`;

/** Một process, một Map cache. PostgreSQL là nơi lưu dữ liệu bền vững. */
export class ChatService {
  constructor({ databaseUrl, pool, logger = console }) {
    this.pool = pool ?? new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5000,
      query_timeout: 8000,
    });
    this.logger = logger;
    this.cache = new Map();
    this.queues = new Map();
    this.pool.on('error', (error) => this.logger.error(`[DB ERROR] ${error.message}`));
  }

  async initialize() {
    const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
    await this.pool.query(sql);
  }

  // Tuần tự hóa đọc/ghi trong mỗi kênh: GET đang đọc DB không ghi đè cache của tin mới.
  async inChannel(channel, operation) {
    const previous = this.queues.get(channel) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.queues.set(channel, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(channel) === current) this.queues.delete(channel);
    }
  }

  async loadHistory(channel) {
    const result = await this.pool.query(
      `SELECT ${fields} FROM messages WHERE channel_id = $1 ORDER BY id`, [channel],
    );
    this.cache.set(channel, result.rows);
    return result.rows;
  }

  async history(channel, after = 0) {
    return this.inChannel(channel, async () => {
      const cacheStatus = this.cache.has(channel) ? 'HIT' : 'MISS';
      const messages = this.cache.get(channel) ?? await this.loadHistory(channel);
      this.logger.log(`[CACHE ${cacheStatus}] channel=${channel} after=${after} total=${messages.length}`);
      return { channel, cache: cacheStatus, messages: messages.filter((message) => message.id > after) };
    });
  }

  async save(event) {
    return this.inChannel(event.channel, async () => {
      const inserted = await this.pool.query(
        `INSERT INTO messages (channel_id, "user", text, client_msg_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (channel_id, "user", client_msg_id) DO NOTHING
         RETURNING ${fields}`,
        [event.channel, event.user, event.text, event.client_msg_id],
      );
      const duplicate = inserted.rowCount === 0;
      const message = duplicate
        ? (await this.pool.query(
          `SELECT ${fields} FROM messages WHERE channel_id = $1 AND "user" = $2 AND client_msg_id = $3`,
          [event.channel, event.user, event.client_msg_id],
        )).rows[0]
        : inserted.rows[0];

      this.logger.log(`[DB ${duplicate ? 'DUPLICATE' : 'INSERT'}] channel=${event.channel} id=${message.id} user=${event.user}`);
      if (this.cache.has(event.channel)) {
        const cached = this.cache.get(event.channel);
        if (!cached.some((item) => item.id === message.id)) cached.push(message);
      } else {
        // Nếu ghi trước lần GET đầu, cần nạp cả tin cũ chứ không chỉ cache tin vừa gửi.
        await this.loadHistory(event.channel);
      }
      this.logger.log(`[CACHE UPDATE] channel=${event.channel} total=${this.cache.get(event.channel).length}`);
      return { message, duplicate };
    });
  }

  async close() {
    await Promise.allSettled([...this.queues.values()]);
    await this.pool.end();
  }
}
