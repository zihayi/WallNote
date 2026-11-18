"""LAN HTTPS receiver. Calendar data and credentials remain on this computer."""
import argparse
import datetime as dt
import hmac
import json
import os
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from command_store import CommandStore
from pairing import PairingManager
from discovery import DiscoveryServer, lan_address

ROOT = Path(__file__).resolve().parent
ZONE = dt.timezone(dt.timedelta(hours=8))
LOCK = threading.Lock()
MAX_BODY = 16 * 1024 * 1024


def validate_payload(data):
    if not isinstance(data, dict) or data.get('schemaVersion') != 1:
        raise ValueError('Unsupported calendar payload')
    for key in ('calendars', 'events', 'instances', 'reminders'):
        if not isinstance(data.get(key), list) or len(data[key]) > 100000 or any(not isinstance(row, dict) for row in data[key]):
            raise ValueError('Invalid ' + key)
    ids = [str(row.get('_id', '')) for row in data['events']]
    if '' in ids or len(ids) != len(set(ids)):
        raise ValueError('Missing or duplicate event IDs')
    return data


def persist(data, directory):
    data = validate_payload(data)
    data['receivedAt'] = dt.datetime.now(ZONE).isoformat(timespec='milliseconds')
    directory.mkdir(parents=True, exist_ok=True)
    with LOCK:
        current = directory / 'calendar.json'
        if current.exists():
            (directory / 'calendar.previous.json').write_bytes(current.read_bytes())
        temporary = directory / 'calendar.pending.json'
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, current)
    return {key: len(data[key]) for key in ('calendars', 'events', 'instances', 'reminders')}


class Receiver(BaseHTTPRequestHandler):
    server_version = 'CalendarBridge/4.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, fmt, *args):
        # Never log credentials, request bodies or calendar titles.
        print(dt.datetime.now(ZONE).isoformat(timespec='seconds'), self.command, self.path.split('?')[0], flush=True)

    def reply(self, code, body):
        payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def authorized(self, desktop=False):
        if desktop and self.client_address[0] not in ('127.0.0.1', '::1'):
            return False
        token = self.server.admin_token if desktop else self.server.token
        return bool(token) and hmac.compare_digest(self.headers.get('Authorization', '').encode(), ('Bearer ' + token).encode())

    def snapshot(self):
        with LOCK:
            file = self.server.data_dir / 'calendar.json'
            return json.loads(file.read_text(encoding='utf-8')) if file.exists() else None

    def do_GET(self):
        if not self.authorized(self.path.startswith('/desktop/')):
            return self.reply(401, {'ok': False, 'error': 'Unauthorized'})
        if self.path == '/desktop/state':
            return self.reply(200, dict(ok=True, snapshot=self.snapshot(), **self.server.commands.status()))
        if self.path == '/desktop/pairing':
            return self.reply(200, dict(ok=True, **self.server.pairing.status(), discoveryAvailable=self.server.discovery_available))
        if self.path.startswith('/desktop/command/'):
            try:
                return self.reply(200, {'ok': True, 'command': self.server.commands.get(self.path.removeprefix('/desktop/command/'))})
            except ValueError:
                return self.reply(400, {'ok': False, 'error': 'Invalid command ID'})
        if self.path == '/api/health':
            return self.reply(200, {'ok': True, 'service': 'CalendarBridge', 'version': 4})
        self.reply(404, {'ok': False, 'error': 'Not found'})

    def do_POST(self):
        desktop = self.path.startswith('/desktop/')
        pairing_route = self.path in ('/pair/begin', '/pair/reveal', '/pair/finish')
        if (pairing_route and not lan_address(self.client_address[0]) and self.client_address[0] != '127.0.0.1') or (not pairing_route and not self.authorized(desktop)):
            self.close_connection = True
            return self.reply(401, {'ok': False, 'error': 'Unauthorized'})
        if not pairing_route and self.path not in ('/api/sync', '/api/commands/next', '/api/commands/result', '/desktop/commands', '/desktop/cancel', '/desktop/pairing/open', '/desktop/pairing/approve', '/desktop/pairing/reject'):
            return self.reply(404, {'ok': False, 'error': 'Not found'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self.reply(400, {'ok': False, 'error': 'Invalid length'})
        if not 0 < length <= (4096 if pairing_route or self.path.startswith('/desktop/pairing/') else MAX_BODY):
            self.close_connection = True
            return self.reply(413, {'ok': False, 'error': 'Payload too large or empty'})
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('Incomplete body')
            data = json.loads(raw.decode('utf-8'))
            if not isinstance(data, dict):
                raise ValueError('Invalid request')
            if pairing_route:
                method = {'/pair/begin': self.server.pairing.begin, '/pair/reveal': self.server.pairing.reveal, '/pair/finish': self.server.pairing.finish}[self.path]
                return self.reply(200, dict(ok=True, **method(data, self.client_address[0])))
            if self.path == '/desktop/pairing/open':
                if not self.server.discovery_available:
                    raise ValueError('局域网发现端口不可用，请关闭另一份接收服务后重试')
                return self.reply(200, dict(ok=True, **self.server.pairing.open()))
            if self.path in ('/desktop/pairing/approve', '/desktop/pairing/reject'):
                return self.reply(200, dict(ok=True, **self.server.pairing.decide(data.get('id'), self.path.endswith('/approve'))))
            if self.path == '/api/commands/next':
                return self.reply(200, {'ok': True, 'command': self.server.commands.next(data)})
            if self.path == '/api/commands/result':
                self.server.commands.finish(data)
                return self.reply(200, {'ok': True})
            if self.path == '/desktop/commands':
                snapshot = self.snapshot()
                if snapshot is None:
                    raise ValueError('请先在手机完成一次同步')
                return self.reply(200, {'ok': True, 'id': self.server.commands.submit(data, snapshot)})
            if self.path == '/desktop/cancel':
                self.server.commands.cancel(data.get('id'))
                return self.reply(200, {'ok': True})
            validate_payload(data)
            self.server.commands.register_device(data)
            counts = persist(data, self.server.data_dir)
            return self.reply(200, {'ok': True, 'counts': counts, 'receivedAt': data['receivedAt']})
        except (ValueError, TypeError, KeyError, AttributeError, UnicodeError) as error:
            return self.reply(400, {'ok': False, 'error': str(error) if desktop or pairing_route else 'Invalid calendar data or device'})
        except OSError:
            return self.reply(500, {'ok': False, 'error': 'Could not save data'})


def make_server(config, host=None, port=None, data_dir=None, state_dir=None):
    state_dir = Path(state_dir) if state_dir else ROOT / 'state'
    server = ThreadingHTTPServer((host or config['bindHost'], port if port is not None else config['port']), Receiver)
    server.daemon_threads = True
    server.token = config['token']
    server.admin_token = config['adminToken']
    server.data_dir = Path(data_dir) if data_dir else ROOT / 'data'
    server.commands = CommandStore(server.data_dir / 'commands.sqlite3')
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    fingerprint = x509.load_pem_x509_certificate((state_dir / 'server.crt').read_bytes()).fingerprint(hashes.SHA256()).hex()
    server.pairing = PairingManager(fingerprint, config['token'], server.commands)
    server.discovery_available = False
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    try:
        context.load_cert_chain(state_dir / 'server.crt', state_dir / 'server.key')
        server.socket = context.wrap_socket(server.socket, server_side=True)
    except Exception:
        server.server_close()
        raise
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host')
    parser.add_argument('--port', type=int)
    parser.add_argument('--state-dir', type=Path, default=ROOT / 'state')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--managed', action='store_true', help='由 WallNote 启动，标准输入关闭时退出')
    parser.add_argument('--discovery-port', type=int, default=8767)
    args = parser.parse_args()
    config_file = args.state_dir / 'config.json'
    if args.managed and not config_file.exists():
        from setup_receiver import setup, local_address
        setup(args.state_dir, local_address() or '192.168.1.1')
    if not config_file.exists():
        parser.error('请先运行 setup_receiver.py 初始化接收服务')
    config = json.loads(config_file.read_text(encoding='utf-8'))
    with make_server(config, args.host, 0 if args.managed else args.port, args.data_dir, args.state_dir) as server:
        discovery = None
        try:
            discovery = DiscoveryServer(server.server_port, server.pairing.fingerprint, server.pairing, bind_host=args.host or '0.0.0.0', port=args.discovery_port)
            server.discovery_available = True
        except OSError:
            pass
        if args.managed:
            # Tokens stay in local files, never on the command line or in stdout.
            from setup_receiver import atomic_json
            profile_file = args.state_dir / 'wallnote-connection.json'
            profile = json.loads(profile_file.read_text(encoding='utf-8'))
            profile['baseUrl'] = f'https://127.0.0.1:{server.server_port}'
            atomic_json(profile_file, profile)
            print(json.dumps({'ready': True, 'port': server.server_port, 'discoveryAvailable': server.discovery_available, 'discoveryPort': discovery.port if discovery else 0}), flush=True)
            def parent_lifetime():
                for line in sys.stdin:
                    if line.strip() == 'stop':
                        break
                server.shutdown()
            threading.Thread(target=parent_lifetime, daemon=True).start()
        else:
            print(f'CalendarBridge HTTPS port {server.server_port}. Ctrl+C to stop.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            if discovery:
                discovery.close()


if __name__ == '__main__':
    main()
