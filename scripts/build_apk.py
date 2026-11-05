"""Build a signed, installable APK using JDK 17 and the official Android SDK tools."""
from pathlib import Path
import os
import secrets
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get('ANDROID_HOME', ROOT / '.tooling/sdk'))
TOOLS = SDK / 'build-tools/35.0.0'
ANDROID = SDK / 'platforms/android-35/android.jar'
BUILD = ROOT / 'build'
DIST = ROOT / 'dist'
SOURCE = ROOT / 'app/src/main'

def run(*args):
    subprocess.run([str(a) for a in args], cwd=ROOT, check=True)

def main():
    if not ANDROID.exists() or not (TOOLS / 'aapt2.exe').exists():
        raise SystemExit('Run python scripts/setup_sdk.py first, or set ANDROID_HOME to an SDK with platform 35 and build-tools 35.0.0.')
    for folder in [BUILD, DIST, BUILD / 'classes', BUILD / 'dex', BUILD / 'generated']:
        folder.mkdir(parents=True, exist_ok=True)
    aapt = TOOLS / 'aapt2.exe'
    run(aapt, 'compile', '--dir', SOURCE / 'res', '-o', BUILD / 'resources.zip')
    run(aapt, 'link', '-I', ANDROID, '--manifest', SOURCE / 'AndroidManifest.xml', '--java', BUILD / 'generated', '-A', SOURCE / 'assets', '-o', BUILD / 'unsigned.apk', BUILD / 'resources.zip')
    java_files = list((SOURCE / 'java').rglob('*.java')) + list((BUILD / 'generated').rglob('*.java'))
    run('javac', '-encoding', 'UTF-8', '--release', '8', '-classpath', ANDROID, '-d', BUILD / 'classes', *java_files)
    classes = list((BUILD / 'classes').rglob('*.class'))
    run('java', '-cp', TOOLS / 'lib/d8.jar', 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', ANDROID, '--output', BUILD / 'dex', *classes)
    with zipfile.ZipFile(BUILD / 'unsigned.apk', 'a', compression=zipfile.ZIP_DEFLATED) as archive:
        for dex in (BUILD / 'dex').glob('*.dex'):
            archive.write(dex, dex.name)
    run(TOOLS / 'zipalign.exe', '-f', '-p', '4', BUILD / 'unsigned.apk', BUILD / 'aligned.apk')
    signing = ROOT / '.signing'
    signing.mkdir(exist_ok=True)
    password_file = signing / 'password.txt'
    keystore = signing / '2048-choice.p12'
    if not keystore.exists():
        password_file.write_text(secrets.token_urlsafe(32), encoding='utf-8')
        run('keytool', '-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12', '-storepass:file', password_file, '-alias', '2048-choice', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=2048 Choice, O=Personal Games, C=IN')
    output = DIST / '2048-Choice.apk'
    run('java', '-jar', TOOLS / 'lib/apksigner.jar', 'sign', '--ks', keystore, '--ks-key-alias', '2048-choice', '--ks-pass', 'file:' + str(password_file), '--out', output, BUILD / 'aligned.apk')
    run('java', '-jar', TOOLS / 'lib/apksigner.jar', 'verify', '--verbose', output)
    run(TOOLS / 'aapt2.exe', 'dump', 'badging', output)
    print(f'\nAPK ready: {output} ({output.stat().st_size:,} bytes)')

if __name__ == '__main__':
    main()
