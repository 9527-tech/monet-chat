import zipfile, sys, json
apk = r'D:\OneDrive\Documents\deepseek-harness\default-workspace\monet-chat\android\app\build\outputs\apk\release\app-release.apk'
z = zipfile.ZipFile(apk)
css = z.read('assets/public/app.css')
js = z.read('assets/public/app.js')
html = z.read('assets/public/index.html')
print(json.dumps({
    'css': len(css),
    'md3': b'Material 3 refactor layer' in css,
    'nav': b'mobile-nav' in html,
    'v140': b"const APP_VERSION = '1.4.0'" in js,
    'scan': b'openScanJoin' in js,
    'haptics': b'applyHapticsSetting' in js,
    'keepAlive': b'KeepAlive' in js,
}, ensure_ascii=False))
