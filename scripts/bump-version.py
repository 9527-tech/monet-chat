import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent

p = root / 'app.js'
s = p.read_text(encoding='utf-8').replace("const APP_VERSION = '1.1.0';", "const APP_VERSION = '1.1.1';")
p.write_text(s, encoding='utf-8', newline='\n')

p = root / 'server.mjs'
s = p.read_text(encoding='utf-8').replace("version: '1.1.0'", "version: '1.1.1'")
p.write_text(s, encoding='utf-8', newline='\n')

p = root / 'sw.js'
s = p.read_text(encoding='utf-8').replace('monet-chat-v1.1.0', 'monet-chat-v1.1.1')
p.write_text(s, encoding='utf-8', newline='\n')

for name in ('package.json', 'package-lock.json'):
    p = root / name
    data = json.loads(p.read_text(encoding='utf-8'))
    data['version'] = '1.1.1'
    if name == 'package-lock.json' and '' in data.get('packages', {}):
        data['packages']['']['version'] = '1.1.1'
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

p = root / 'android/app/build.gradle'
s = p.read_text(encoding='utf-8').replace('versionCode 2', 'versionCode 3').replace('versionName "1.1.0"', 'versionName "1.1.1"')
p.write_text(s, encoding='utf-8', newline='\n')
print('bumped to 1.1.1')
