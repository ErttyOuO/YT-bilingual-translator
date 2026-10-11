#!/usr/bin/env python3
"""Package the Firefox add-on for addons.mozilla.org.

Usage:  python tools/build-xpi.py
Output: dist/yt-bilingual-translator-<version>.xpi

Only runtime files are packaged. Sources are shipped as-is (no minifier or
bundler), so AMO does not need a separate source-code upload. Paths inside the
archive always use forward slashes; Windows' Compress-Archive in PowerShell 5.1
writes backslashes, which AMO rejects.
"""
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

RUNTIME_FILES = [
    'manifest.json',
    'lang-codes.js',
    'bergamot-engine.js',
    'background.js',
    # Third-party, unmodified (see vendor/bergamot/README.md).
    'vendor/bergamot/translator-worker.js',
    'vendor/bergamot/bergamot-translator-worker.js',
    'vendor/bergamot/bergamot-translator-worker.wasm',
    'vendor/bergamot/LICENSE',
    'vendor/bergamot/README.md',
    'content.js',
    'content.css',
    'page-bridge.js',
    'i18n.js',
    'twitch-content.js',
    'twitch-content.css',
    'popup/popup.html',
    'popup/popup.css',
    'popup/popup.js',
    'icons/brand-cc-48.png',
    'icons/brand-cc-96.png',
    'icons/brand-cc-128.png',
    'LICENSE',
]

# Fixed timestamp keeps the archive byte-identical between builds.
FIXED_DATE = (2026, 1, 1, 0, 0, 0)


def referenced_files(manifest):
    """Every file the manifest points at, so a rename cannot ship a broken package."""
    refs = set(manifest.get('background', {}).get('scripts', []))
    for script in manifest.get('content_scripts', []):
        refs.update(script.get('js', []))
        refs.update(script.get('css', []))
    refs.update(manifest.get('icons', {}).values())
    refs.update(manifest.get('browser_action', {}).get('default_icon', {}).values())
    if manifest.get('browser_action', {}).get('default_popup'):
        refs.add(manifest['browser_action']['default_popup'])
    if manifest.get('options_ui', {}).get('page'):
        refs.add(manifest['options_ui']['page'])
    refs.update(manifest.get('web_accessible_resources', []))
    return refs


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']

    missing = [name for name in RUNTIME_FILES if not (ROOT / name).is_file()]
    unlisted = sorted(referenced_files(manifest) - set(RUNTIME_FILES))
    if missing or unlisted:
        print('Missing files:', missing, file=sys.stderr)
        print('Referenced by manifest but not packaged:', unlisted, file=sys.stderr)
        return 1

    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    target = dist / f'yt-bilingual-translator-{version}.xpi'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in RUNTIME_FILES:
            info = zipfile.ZipInfo(name, date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (ROOT / name).read_bytes())

    with zipfile.ZipFile(target) as archive:
        bad = archive.testzip()
        if bad:
            print('Corrupt entry:', bad, file=sys.stderr)
            return 1
        names = archive.namelist()

    print(f'Built {target.relative_to(ROOT).as_posix()} ({target.stat().st_size:,} bytes, {len(names)} files, version {version})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
