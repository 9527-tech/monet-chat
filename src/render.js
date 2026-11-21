/* Monet Chat — HTML renderers (kept free of app state; all inputs are plain data) */

import {
  avatarHTML, escapeHTML, formatBytes, formatDay, formatDuration, formatListTime, formatTime,
  fileIcon, fileExt, renderRichText, clamp, hashString,
} from './util.js';
import { icon } from './ui.js';

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s){1,12}$/u;

export function previewText(msg) {
  if (!msg) return '';
  if (msg.deleted) return '消息已删除';
  switch (msg.type) {
    case 'image': return msg.text ? `[图片] ${msg.text}` : '[图片]';
    case 'file': return `[文件] ${msg.meta?.name || ''}`.trim();
    case 'voice': return `[语音] ${formatDuration(msg.meta?.duration || 0)}`;
    case 'call': {
      const label = msg.meta?.kind === 'video' ? '视频通话' : '语音通话';
      const state = msg.meta?.status === 'missed' ? '未接' : msg.meta?.status === 'declined' ? '已拒绝' : formatDuration(msg.meta?.duration || 0);
      return `[${label}] ${state}`;
    }
    case 'system': return msg.text || '';
    default: return msg.text || '';
  }
}

export function messageTypeIcon(msg) {
  if (!msg) return '';
  if (msg.type === 'image') return 'image';
  if (msg.type === 'file') return 'draft';
  if (msg.type === 'voice') return 'mic';
  if (msg.type === 'call') return msg.meta?.kind === 'video' ? 'videocam' : 'call';
  return '';
}

function statusIcon(status) {
  if (status === 'sending') return icon('schedule', 'msg-status');
  if (status === 'failed') return icon('error', 'msg-status');
  if (status === 'read') return icon('done_all', 'msg-status read');
  if (status === 'delivered') return icon('done_all', 'msg-status');
  if (status === 'sent') return icon('check', 'msg-status');
  return icon('schedule', 'msg-status');
}

function statusLabel(status) {
  return ({
    sending: '发送中', sent: '已发送', delivered: '已送达', read: '已读', failed: '发送失败',
    waiting: '等待对方接收',
  })[status] || '';
}

function avatarOf(entity) {
  if (!entity) return '';
  return avatarHTML({ id: entity.id, name: entity.name, avatar: entity.avatar }, { size: 32 });
}

function reactionMarkup(msg, meId) {
  const entries = Object.entries(msg.reactions || {}).filter(([, ids]) => Array.isArray(ids) && ids.length);
  if (!entries.length) return '';
  return `<div class="reactions">${entries.map(([emoji, ids]) => {
    const mine = ids.includes(meId);
    return `<button class="reaction-chip ${mine ? 'mine' : ''}" data-act="reaction" data-emoji="${escapeHTML(emoji)}" title="${ids.length} 个反应">${emoji}<b>${ids.length}</b></button>`;
  }).join('')}</div>`;
}

function replyMarkup(msg) {
  if (!msg.replyTo) return '';
  const r = msg.replyTo;
  return `<button class="reply-quote" data-act="jump" data-target="${escapeHTML(r.id || '')}" type="button">
    <b>${escapeHTML(r.fromName || '回复')}</b><span>${escapeHTML(previewText(r))}</span>
  </button>`;
}

function imageMarkup(msg, urlFor) {
  const url = urlFor(msg);
  if (!url) {
    return `<div class="image-attachment image-loading"><div class="spinner"></div></div>`;
  }
  return `<button class="image-attachment" data-act="image" type="button">
    <img src="${escapeHTML(url)}" alt="${escapeHTML(msg.meta?.name || '图片')}" loading="lazy" draggable="false" />
    ${msg.transfer && !msg.blob && msg.transfer.received < msg.transfer.total ? `<span class="image-meta">${Math.round((msg.transfer.received / Math.max(1, msg.transfer.total)) * 100)}%</span>` : ''}
  </button>`;
}

function fileMarkup(msg, out) {
  const meta = msg.meta || {};
  const pct = msg.transfer ? Math.round((msg.transfer.received / Math.max(1, msg.transfer.total)) * 100) : 100;
  const active = msg.transfer && msg.transfer.received < msg.transfer.total;
  const needsAccept = !out && meta.requiresAccept && !msg.accepted && !msg.blob;
  const waiting = out && meta.requiresAccept && !msg.accepted && !msg.transfer;
  const hint = needsAccept ? '点击接收' : waiting ? '等待对方接收' : active ? `${pct}%` : '';
  return `<button class="file-attachment${needsAccept ? ' awaiting' : ''}" data-act="${needsAccept ? 'accept-file' : 'file'}" type="button">
    <span class="file-ico">${icon(fileIcon(meta.name, meta.mime || ''))}</span>
    <span class="file-info">
      <span class="file-name">${escapeHTML(meta.name || '文件')}</span>
      ${meta.note ? `<span class="file-note">${escapeHTML(meta.note)}</span>` : ''}
      <span class="file-size">${formatBytes(meta.size || 0)} · ${escapeHTML(fileExt(meta.name || ''))}${hint ? ` · <b class="file-accept-label">${hint}</b>` : ''}</span>
      ${active ? `<span class="file-progress"><i style="width:${pct}%"></i></span>` : ''}
    </span>
    <span class="file-dl">${icon(needsAccept ? 'download_for_offline' : active ? 'downloading' : 'download')}</span>
  </button>`;
}

function waveformBars(waveform, msgId) {
  const bars = Array.isArray(waveform) && waveform.length
    ? waveform
    : Array.from({ length: 34 }, (_, i) => 0.28 + ((hashString(`${msgId}:${i}`) % 60) / 100));
  return bars.map((v) => `<i style="height:${clamp(Math.round(v * 100), 12, 100)}%"></i>`).join('');
}

function voiceMarkup(msg) {
  const meta = msg.meta || {};
  return `<button class="voice-attachment" data-act="voice" type="button">
    <span class="voice-play">${icon('play_arrow')}</span>
    <span class="voice-wave" data-msg="${escapeHTML(msg.id)}">${waveformBars(meta.waveform, msg.id)}</span>
    <span class="voice-dur">${formatDuration(meta.duration || 0)}</span>
  </button>`;
}

function callMarkup(msg) {
  const meta = msg.meta || {};
  const state = meta.status === 'missed' ? '未接来电' : meta.status === 'declined' ? '已拒绝' : formatDuration(meta.duration || 0);
  return `<div class="call-log">
    <span class="call-log-icon">${icon(meta.kind === 'video' ? 'videocam' : 'call')}</span>
    <span class="call-log-main"><b>${meta.kind === 'video' ? '视频通话' : '语音通话'}</b><small>${state}</small></span>
  </div>`;
}

export function messageHTML(msg, ctx) {
  const { meId, chat, urlFor, prev, next, now = Date.now() } = ctx;
  if (msg.type === 'system') {
    return `<div class="msg-system" data-msg-id="${escapeHTML(msg.id)}">${escapeHTML(msg.text || '')}</div>`;
  }

  const out = msg.from === meId;
  const grouped = !!prev && prev.from === msg.from && prev.type !== 'system' && (msg.ts - prev.ts) < 5 * 60 * 1000;
  const followed = !!next && next.from === msg.from && next.type === msg.type && (next.ts - msg.ts) < 5 * 60 * 1000;
  const sender = out ? (ctx.me || { id: meId }) : (chat.members || []).find((m) => m.id === msg.from) || { id: msg.from, name: msg.fromName };
  const classes = ['msg', out ? 'out' : 'in', grouped ? 'grouped' : '', followed ? 'followed' : ''].filter(Boolean).join(' ');
  const onlyEmoji = msg.type === 'text' && !msg.deleted && [...(msg.text || '')].length <= 12 && EMOJI_ONLY.test(msg.text || '');
  const edited = msg.editedAt ? `<span class="msg-edited">已编辑</span>` : '';
  const deleted = msg.deleted ? `<div class="msg-text msg-deleted">此消息已被删除</div>` : '';

  let body = '';
  if (deleted) body = deleted;
  else if (msg.type === 'image') {
    body = `${imageMarkup(msg, urlFor)}${msg.text ? `<div class="image-cap">${renderRichText(msg.text)}</div>` : ''}`;
  } else if (msg.type === 'file') {
    body = fileMarkup(msg, out);
  } else if (msg.type === 'voice') {
    body = voiceMarkup(msg);
  } else if (msg.type === 'call') {
    body = callMarkup(msg);
  } else {
    body = `<div class="msg-text">${renderRichText(msg.text || '')}</div>`;
  }

  const media = ['image', 'file', 'voice'].includes(msg.type) && !msg.deleted;
  const bubbleClass = `bubble${media ? ' media-bubble' : ''}${onlyEmoji ? ' emoji-only' : ''}`;

  return `<div class="${classes}" data-msg-id="${escapeHTML(msg.id)}" data-from="${escapeHTML(msg.from)}">
    <div class="msg-avatar">${grouped ? '' : avatarOf(sender)}</div>
    <div class="msg-col">
      ${!out && chat.type === 'group' && !grouped ? `<div class="msg-author">${escapeHTML(sender?.name || msg.fromName || '成员')}</div>` : ''}
      <div class="${bubbleClass}">
        ${replyMarkup(msg)}
        ${body}
      </div>
      ${reactionMarkup(msg, meId)}
      <div class="msg-meta">
        ${msg.pinned ? icon('keep', 'pin-ico') : ''}
        <span class="msg-time">${formatTime(msg.ts)}</span>
        ${edited}
        ${out ? `<span class="msg-status" title="${statusLabel(msg.status)}">${statusIcon(msg.status)}</span>` : ''}
      </div>
      <div class="msg-actions">
        <button class="icon-btn" data-act="reply" aria-label="回复" title="回复">${icon('reply')}</button>
        <button class="icon-btn" data-act="react" aria-label="添加反应" title="添加反应">${icon('add_reaction')}</button>
        ${msg.type === 'text' && !msg.deleted ? `<button class="icon-btn" data-act="copy" aria-label="复制" title="复制">${icon('content_copy')}</button>` : ''}
        ${msg.pinned ? `<button class="icon-btn" data-act="unpin" aria-label="取消置顶" title="取消置顶">${icon('keep_off')}</button>` : `<button class="icon-btn" data-act="pin" aria-label="置顶" title="置顶">${icon('keep')}</button>`}
        <button class="icon-btn" data-act="menu" aria-label="更多" title="更多">${icon('more_horiz')}</button>
      </div>
    </div>
  </div>`;
}

export function renderMessages(container, messages, ctx) {
  if (!messages.length) {
    container.innerHTML = `<div class="list-empty chat-empty">${icon('forum')}<div>还没有消息</div><small>说点什么，消息会通过 P2P 加密通道直达对方。</small></div>`;
    return;
  }
  const parts = [];
  let lastDay = 0;
  messages.forEach((msg, i) => {
    const day = new Date(msg.ts).setHours(0, 0, 0, 0);
    if (day !== lastDay) {
      parts.push(`<div class="day-divider"><span>${formatDay(msg.ts)}</span></div>`);
      lastDay = day;
    }
    parts.push(messageHTML(msg, { ...ctx, prev: messages[i - 1], next: messages[i + 1] }));
  });
  container.innerHTML = `<div class="messages-inner">${parts.join('')}</div>`;
}

export function chatRowHTML(chat, ctx) {
  const { active, presence, typing, meId } = ctx;
  const entity = chat.type === 'dm'
    ? (chat.peer || { id: chat.peerId || chat.id, name: chat.name, avatar: chat.avatar })
    : { id: chat.id, name: chat.name, avatar: chat.avatar };
  const online = chat.type === 'dm'
    ? (typeof presence === 'function' ? !!presence(chat.peerId) : !!presence)
    : chat.online > 0;
  const isTyping = typeof typing === 'function' ? !!typing(chat.id) : !!typing;
  const last = chat.lastMsg;
  let preview = '';
  if (isTyping) {
    preview = `<span class="typing-preview">正在输入…</span>`;
  } else if (typeof last === 'string') {
    preview = `<span class="preview-text">${escapeHTML(last)}</span>`;
  } else if (last) {
    const author = chat.type === 'group' && last.from !== meId ? `<span class="preview-author">${escapeHTML(last.fromName || '')}: </span>` : '';
    const outPrefix = last.from === meId && !last.deleted ? `<span class="preview-author">你: </span>` : '';
    const typeIco = messageTypeIcon(last);
    preview = `${author}${outPrefix}${typeIco ? icon(typeIco) : ''}<span class="preview-text">${escapeHTML(previewText(last))}</span>`;
  } else if (chat.pending) {
    preview = `<span class="preview-text">等待对方加入…</span>`;
  } else {
    preview = `<span class="preview-text">还没有消息</span>`;
  }
  const unread = chat.unread || 0;
  return `<button class="chat-row ${active ? 'active' : ''}" data-chat-id="${escapeHTML(chat.id)}" role="listitem">
    ${avatarHTML(entity, { size: 48, showStatus: chat.type === 'dm', status: online })}
    <span class="chat-row-main">
      <span class="chat-row-top">
        <span class="chat-row-name">${escapeHTML(chat.name || '未命名会话')}</span>
        <span class="chat-row-time">${formatListTime(chat.lastTs)}</span>
      </span>
      <span class="chat-row-preview">${preview}</span>
    </span>
    <span class="chat-row-side">
      ${chat.pinned ? icon('keep', 'pin-ico') : ''}
      ${chat.muted ? icon('notifications_off', 'muted-ico') : ''}
      ${unread > 0 && !chat.muted ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
      ${unread > 0 && chat.muted ? `<span class="unread-dot"></span>` : ''}
    </span>
  </button>`;
}

export function renderChatList(container, chats, ctx) {
  if (!chats.length) {
    container.innerHTML = `<div class="list-empty">${icon('chat_bubble')}<div>还没有会话</div><small>创建邀请码或输入邀请码开始聊天</small></div>`;
    return;
  }
  container.innerHTML = chats.map((chat) => chatRowHTML(chat, ctx)).join('');
}

function highlight(text, query) {
  const safe = escapeHTML(text || '');
  if (!query) return safe;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return safe.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>');
  } catch {
    return safe;
  }
}

export function renderSearchResults(container, { chats, messages, query, chatTitle, meId }) {
  if (!query) {
    container.innerHTML = '';
    return;
  }
  const sections = [];
  if (chats.length) {
    sections.push(`<div class="search-section-title">会话</div>${chats.map((c) => `
      <button class="search-hit" data-chat-id="${escapeHTML(c.id)}">
        <div class="search-hit-top"><span>${highlight(c.name, query)}</span><span>${c.type === 'group' ? '群聊' : '私聊'}</span></div>
        <div class="search-hit-text">${escapeHTML(previewText(c.lastMsg) || '没有消息')}</div>
      </button>`).join('')}`);
  }
  if (messages.length) {
    sections.push(`<div class="search-section-title">消息</div>${messages.map((m) => `
      <button class="search-hit" data-chat-id="${escapeHTML(m.chatId)}" data-msg-id="${escapeHTML(m.id)}">
        <div class="search-hit-top"><span>${highlight(chatTitle(m.chatId), query)}</span><span>${formatListTime(m.ts)}</span></div>
        <div class="search-hit-text">${highlight(previewText(m), query)}</div>
      </button>`).join('')}`);
  }
  container.innerHTML = sections.length ? sections.join('') : `<div class="list-empty">${icon('search_off')}<div>没有找到相关内容</div></div>`;
}

export function renderTyping(container, names) {
  if (!names.length) {
    container.innerHTML = '';
    container.classList.remove('show');
    return;
  }
  const label = names.length === 1 ? `${names[0]} 正在输入` : `${names.slice(0, 2).join('、')} 正在输入`;
  container.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span><span>${escapeHTML(label)}</span>`;
  container.classList.add('show');
}

export function renderPinned(container, pinned, meId) {
  if (!pinned.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  const msg = pinned[pinned.length - 1];
  const all = pinned.length > 1 ? ` · 共 ${pinned.length} 条` : '';
  container.classList.remove('hidden');
  container.innerHTML = `${icon('keep')}<button class="pin-text" data-act="jump" data-target="${escapeHTML(msg.id)}"><b>${escapeHTML(msg.from === meId ? '你' : (msg.fromName || '消息'))}</b> ${escapeHTML(previewText(msg))}${all}</button><button data-act="unpin" data-target="${escapeHTML(msg.id)}" aria-label="取消置顶">${icon('close')}</button>`;
}

export function renderComposerContext(container, ctx) {
  if (!ctx || !ctx.type) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  const label = ctx.type === 'edit' ? '编辑消息' : ctx.type === 'reply' ? '回复' : '转发';
  const preview = previewText(ctx.message);
  container.classList.remove('hidden');
  container.innerHTML = `<span class="icon">${ctx.type === 'edit' ? 'edit' : 'reply'}</span><div class="ctx-main"><b>${label} ${escapeHTML(ctx.message?.fromName || '')}</b><span>${escapeHTML(preview)}</span></div><button class="icon-btn" data-act="cancel-context" aria-label="取消">${icon('close')}</button>`;
}

export function renderMeCard(container, me) {
  if (!me) return;
  container.innerHTML = `${avatarHTML(me, { size: 38, showStatus: true, status: true })}
    <div class="me-text"><strong>${escapeHTML(me.name || '我')}</strong><small>${escapeHTML(me.id?.slice(0, 10) || '')}…</small></div>
    ${icon('settings', 'me-gear')}`;
}

export function renderNetworkChip(el, state, detail) {
  const map = {
    online: ['online', '已连接'],
    connecting: ['connecting', '连接中'],
    reconnecting: ['connecting', '重连中'],
    offline: ['offline', '离线'],
    error: ['error', '无法连接'],
  };
  const [cls, label] = map[state] || map.offline;
  el.className = `net-chip ${cls}`;
  el.innerHTML = `<i></i><b>${detail || label}</b>`;
}

export function renderInfo(chat, ctx) {
  const { me, presence, safety, simple } = ctx;
  const isDm = chat.type === 'dm';
  const entity = isDm ? (chat.peer || { id: chat.peerId, name: chat.name, avatar: chat.avatar, bio: chat.bio }) : { id: chat.id, name: chat.name, avatar: chat.avatar };
  const members = chat.members || [];
  const online = isDm ? !!presence : members.filter((m) => ctx.onlineIds?.has(m.id)).length;

  const hero = `<div class="info-hero">
    ${avatarHTML(entity, { size: 88, showStatus: isDm, status: !!presence })}
    <h3>${escapeHTML(chat.name || '会话')}</h3>
    <p>${escapeHTML(entity.bio || (isDm ? 'P2P 直连 · 端到端加密' : `${members.length} 位成员`))}</p>
    ${isDm ? `<div class="id-chip">${icon('fingerprint')}<span>${escapeHTML(entity.id || '')}</span></div>` : `<div class="id-chip">${icon('tag')}<span>${escapeHTML(chat.room || '')}</span></div>`}
  </div>`;

  const encrypt = !isDm ? '' : simple
    ? `<div class="info-section"><div class="info-row">${icon('enhanced_encryption')}<span class="info-row-main"><b>端到端加密</b><small>只有你和对方能读这条会话</small></span></div></div>`
    : `<div class="info-section">
    <div class="info-section-title">安全号码</div>
    <p class="info-note">对比双方设备上的 12 组数字。完全一致，说明没有中间人。</p>
    <div class="safety-grid">${(safety || []).map((n) => `<span>${escapeHTML(n)}</span>`).join('')}</div>
    <button class="btn text" data-act="verify">${icon('verified_user')}<span>标记为已验证</span></button>
  </div>`;

  const callSection = isDm ? `<div class="info-section">
    <div class="info-section-title">通话</div>
    <div class="info-call-row">
      <button class="btn tonal" data-act="call-audio">${icon('call')}<span>语音</span></button>
      <button class="btn tonal" data-act="call-video">${icon('videocam')}<span>视频</span></button>
    </div>
  </div>` : '';

  const groupSection = !isDm ? `<div class="info-section">
    <div class="info-section-title">邀请成员</div>
    <button class="info-row" data-act="invite">${icon('qr_code_2')}<span class="info-row-main"><b>分享邀请码</b><small>${escapeHTML(chat.room || '')}</small></span>${icon('chevron_right')}</button>
  </div>
  <div class="info-section">
    <div class="info-section-title">成员 · ${members.length}</div>
    <div class="member-list">${members.map((m) => `<div class="member-row">
      ${avatarHTML(m, { size: 36, showStatus: true, status: ctx.onlineIds?.has(m.id) })}
      <span class="member-info"><b>${escapeHTML(m.name || '成员')}</b><small>${m.id === me.id ? '我' : (ctx.onlineIds?.has(m.id) ? '在线' : '离线')}</small></span>
      ${m.id === me.id ? `<span class="member-tag">我</span>` : ''}
    </div>`).join('')}</div>
  </div>` : '';

  const actions = `<div class="info-section">
    <div class="info-section-title">会话设置</div>
    <button class="info-row" data-act="mute">${icon(chat.muted ? 'notifications_off' : 'notifications')}<span class="info-row-main"><b>${chat.muted ? '取消静音' : '静音通知'}</b><small>${chat.muted ? '当前已静音' : '收到消息时仍会提醒'}</small></span></button>
    <button class="info-row" data-act="pin">${icon('keep')}<span class="info-row-main"><b>${chat.pinned ? '取消置顶' : '置顶会话'}</b><small>固定在列表顶部</small></span></button>
    <button class="info-row" data-act="search">${icon('search')}<span class="info-row-main"><b>搜索消息</b><small>在当前会话中查找</small></span></button>
    <button class="info-row" data-act="media">${icon('photo_library')}<span class="info-row-main"><b>共享媒体</b><small>${ctx.mediaCount || 0} 个文件</small></span></button>
  </div>
  <div class="info-section">
    <div class="info-section-title">数据</div>
    <button class="info-row" data-act="export">${icon('download')}<span class="info-row-main"><b>导出聊天记录</b><small>JSON 格式，保存在本机</small></span></button>
    <button class="info-row" data-act="clear">${icon('delete_sweep')}<span class="info-row-main"><b>清空聊天记录</b><small>只影响当前设备</small></span></button>
    <button class="info-row danger" data-act="${isDm ? 'delete' : 'leave'}">${icon(isDm ? 'person_remove' : 'logout')}<span class="info-row-main"><b>${isDm ? '删除会话' : '退出群聊'}</b><small>${isDm ? '同时删除本机消息' : '不会再收到该群消息'}</small></span></button>
  </div>`;

  return hero + encrypt + (isDm && !simple ? `<div class="info-section"><div class="info-section-title">状态</div>
    <div class="info-row">${icon(presence ? 'wifi' : 'wifi_off')}<span class="info-row-main"><b>${presence ? 'P2P 已连接' : '等待连接'}</b><small>${presence ? '消息不经过服务器' : '对方上线后自动建立直连'}</small></span></div>
  </div>` : '') + callSection + groupSection + actions;
}

export function renderCall(root, session, streams) {
  if (!session) {
    root.classList.add('hidden');
    root.innerHTML = '';
    return;
  }
  root.classList.remove('hidden');
  const kind = session.kind === 'video' ? 'video' : 'audio';
  const peer = session.peer || {};
  const statusText = session.state === 'active'
    ? formatDuration(session.duration || 0)
    : session.state === 'calling' ? '正在呼叫…' : session.state === 'ringing' ? '邀请你通话…' : '正在连接…';

  const remoteVideo = kind === 'video' ? `<video class="call-remote-video" autoplay playsinline></video>` : '';
  root.innerHTML = `<div class="call-screen ${kind}-mode">
    ${remoteVideo}
    <div class="call-remote-placeholder">
      ${avatarHTML(peer, { size: 110 })}
      <h2>${escapeHTML(peer.name || '对方')}</h2>
      <div class="call-status call-timer" data-call-state="${session.state}">${statusText}</div>
    </div>
    <video class="call-local-video ${streams.localVideo ? '' : 'hidden'}" autoplay playsinline muted></video>
    <div class="call-top">
      <button class="icon-btn" data-call-act="minimize" aria-label="收起">${icon('keyboard_arrow_down')}</button>
      <div class="call-top-info"><b>${escapeHTML(peer.name || '通话')}</b><small>${kind === 'video' ? '视频通话' : '语音通话'}</small></div>
      <span class="call-encrypted">${icon('lock')} 端到端加密</span>
    </div>
    <div class="call-controls">
      <button class="call-btn ${session.muted ? 'off' : ''}" data-call-act="mute" aria-label="静音">${icon(session.muted ? 'mic_off' : 'mic')}</button>
      ${kind === 'video' ? `<button class="call-btn ${session.cameraOff ? 'off' : ''}" data-call-act="camera" aria-label="摄像头">${icon(session.cameraOff ? 'videocam_off' : 'videocam')}</button>
      <button class="call-btn ${session.sharing ? 'active' : ''}" data-call-act="share" aria-label="共享屏幕">${icon('screen_share')}</button>
      <button class="call-btn" data-call-act="switch" aria-label="切换摄像头">${icon('cameraswitch')}</button>
      <button class="call-btn" data-call-act="snapshot" aria-label="截图">${icon('photo_camera')}</button>` : ''}
      <button class="call-btn hangup" data-call-act="hangup" aria-label="挂断">${icon('call_end')}</button>
    </div>
  </div>`;
}

export function renderIncomingCall(root, session) {
  if (!session) {
    root.classList.add('hidden');
    root.innerHTML = '';
    return;
  }
  root.classList.remove('hidden');
  const peer = session.peer || {};
  root.innerHTML = `<div class="call-incoming">
    <div class="incoming-glow"></div>
    ${avatarHTML(peer, { size: 104 })}
    <h2>${escapeHTML(peer.name || '未知来电')}</h2>
    <p>${session.kind === 'video' ? '视频通话邀请' : '语音通话邀请'} · 端到端加密</p>
    <div class="call-incoming-actions">
      <div class="call-action-wrap"><button class="call-btn hangup" data-call-act="reject" aria-label="拒绝">${icon('call_end')}</button><small>拒绝</small></div>
      <div class="call-action-wrap"><button class="call-btn accept" data-call-act="accept" aria-label="接听">${icon('call')}</button><small>接听</small></div>
    </div>
  </div>`;
}
