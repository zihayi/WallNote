"""Bundle only receiver code and dependencies, never local profiles or calendar data."""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    output = args.output.resolve()
    work = ROOT / 'dev' / '.build' / 'receiver'
    output.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--console',
                    '--name', 'CalendarBridge.Receiver', '--distpath', str(output), '--workpath', str(work / 'work'),
                    '--specpath', str(work), str(ROOT / 'server.py')], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
