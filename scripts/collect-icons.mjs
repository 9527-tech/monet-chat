import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
let source = '';
for (const file of ['index.html', 'app.js']) source += fs.readFileSync(path.join(root, file), 'utf8');
for (const file of fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js'))) {
  source += fs.readFileSync(path.join(root, 'src', file), 'utf8');
}
const names = new Set();
for (const re of [/icon\(\s*['"]([a-z0-9_]+)['"]/g, /<span class="icon[^"]*">([a-z0-9_]+)<\/span>/g, /data-icon="([a-z0-9_]+)"/g]) {
  let m;
  while ((m = re.exec(source))) names.add(m[1]);
}
// UI primitives that appear only as bare ligature text in index.html buttons.
for (const name of ['settings', 'add_comment', 'group_add', 'link', 'search', 'more_vert', 'send', 'mic', 'add', 'mood', 'arrow_back', 'call', 'videocam', 'info', 'push_pin', 'close', 'expand_more', 'check', 'content_copy', 'download', 'upload', 'delete', 'edit', 'keep', 'keep_off', 'downloading', 'person_remove', 'movie', 'audio_file', 'picture_as_pdf', 'folder_zip', 'description', 'table_chart', 'slideshow', 'code', 'reply', 'add_reaction', 'image', 'draft', 'play_arrow', 'pause', 'volume_up', 'error', 'schedule', 'done_all', 'download_done', 'photo_library', 'install_mobile', 'encrypted', 'restart_alt', 'delete_sweep', 'archive', 'network_check', 'add_photo_alternate', 'chevron_right', 'north', 'south', 'keyboard_arrow_up', 'keyboard_arrow_down', 'visibility', 'visibility_off', 'person_add', 'logout', 'notifications', 'notifications_off', 'block', 'flag', 'bug_report', 'help', 'qr_code_2', 'qr_code_scanner', 'content_paste', 'screen_share', 'stop_screen_share', 'cameraswitch', 'photo_camera', 'call_end', 'mic_off', 'videocam_off', 'wifi', 'wifi_off', 'cloud_off', 'sync', 'check_circle', 'cancel', 'security', 'fingerprint', 'devices', 'bolt', 'auto_awesome', 'palette', 'wallpaper', 'forum', 'chat_bubble', 'data_usage', 'storage', 'lan', 'public', 'lock', 'diversity_3']) names.add(name);
fs.writeFileSync(path.join(root, 'scripts', 'icon-names.txt'), [...names].sort().join('\n') + '\n');
console.log(`${names.size} icons`);
console.log([...names].sort().join(','));
