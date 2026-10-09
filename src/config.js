export const CHANNELS = Object.freeze([
  { id: 'C_alpha', slug: 'alpha', name: 'alpha', description: 'Kênh trao đổi chung của nhóm' },
  { id: 'C_beta', slug: 'beta', name: 'beta', description: 'Một kênh riêng để thử trao đổi' },
]);

export function resolveChannel(value) {
  return CHANNELS.find((channel) => channel.id === value || channel.slug === value);
}

export function validUser(value) {
  return typeof value === 'string' && value === value.trim()
    && value.length >= 1 && value.length <= 40 && !/[\p{C}]/u.test(value);
}

export class DemoError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function validateSend(event, identity) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.type !== 'message.send') {
    throw new DemoError('INVALID_EVENT', 'Chỉ hỗ trợ event message.send.');
  }
  if (event.channel !== identity.channel.id || event.user !== identity.user) {
    throw new DemoError('INVALID_IDENTITY', 'Kênh hoặc tên người gửi không khớp kết nối.');
  }
  if (typeof event.text !== 'string' || !event.text.trim() || [...event.text.trim()].length > 4000) {
    throw new DemoError('INVALID_TEXT', 'Tin nhắn phải có từ 1 đến 4000 ký tự.');
  }
  if (typeof event.client_msg_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(event.client_msg_id)) {
    throw new DemoError('INVALID_CLIENT_ID', 'client_msg_id không hợp lệ.');
  }
  return {
    channel: identity.channel.id,
    user: identity.user,
    text: event.text.trim(),
    client_msg_id: event.client_msg_id,
  };
}
