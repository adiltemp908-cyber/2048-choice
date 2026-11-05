"""Download only the official Android platform and build tools into this project."""
from pathlib import Path
import hashlib
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT / '.tooling' / 'sdk'
PACKAGES = [
    ('platform-35_r02.zip', '0bb560a90a7a2cbd0dd8348224d518b638fe7949', 'platforms/android-35'),
    ('build-tools_r35_windows.zip', 'af059bb67cf7786f45ee0db85e2d24985df1b4b6', 'build-tools/35.0.0'),
]

def main():
    for filename, checksum, destination in PACKAGES:
        target = SDK / destination
        if (target / ('android.jar' if destination.startswith('platforms') else 'aapt2.exe')).exists():
            print(f'Already installed: {destination}', flush=True)
            continue
        archive = ROOT / '.tooling' / filename
        archive.parent.mkdir(parents=True, exist_ok=True)
        if not archive.exists():
            print(f'Downloading {filename} from dl.google.com', flush=True)
            urllib.request.urlretrieve('https://dl.google.com/android/repository/' + filename, archive)
        if hashlib.sha1(archive.read_bytes()).hexdigest() != checksum:
            raise RuntimeError(f'Checksum mismatch: {filename}. Remove the incomplete download and retry.')
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as z:
            for member in z.infolist():
                parts = Path(member.filename).parts[1:]
                if not parts:
                    continue
                path = (target / Path(*parts)).resolve()
                if not path.is_relative_to(target.resolve()):
                    raise RuntimeError('Unsafe archive entry')
                if member.is_dir():
                    path.mkdir(parents=True, exist_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(z.read(member))
        print(f'Installed {destination}', flush=True)

if __name__ == '__main__':
    main()
