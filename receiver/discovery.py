"""Small LAN-only UDP discovery responder; replies contain no credentials."""
import ipaddress
import json
import re
import socket
import threading
import time

PORT = 8767


def lan_address(value):
    try:
        address = ipaddress.IPv4Address(value)
        return any(address in ipaddress.IPv4Network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'))
    except ValueError:
        return False


class DiscoveryServer:
    def __init__(self, https_port, fingerprint, pairing, name=None, bind_host='0.0.0.0', port=PORT):
        self.https_port, self.fingerprint, self.pairing = https_port, fingerprint, pairing
        self.name = (name or socket.gethostname())[:100]
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            self.socket.bind((bind_host, port))
            self.socket.settimeout(.5)
        except Exception:
            self.socket.close()
            raise
        self.port = self.socket.getsockname()[1]
        self.running = True
        self.thread = threading.Thread(target=self.run, name='lan-discovery', daemon=True)
        self.thread.start()

    def response(self, packet, peer):
        if len(packet) > 512 or (not lan_address(peer) and peer != '127.0.0.1'):
            return None
        try:
            request = json.loads(packet)
        except (ValueError, UnicodeError):
            return None
        if not isinstance(request, dict) or request.get('type') != 'calendarbridge-discover' or request.get('version') != 1 or not isinstance(request.get('nonce'), str) or not re.fullmatch('[0-9a-f]{32}', request['nonce']):
            return None
        return {'type': 'calendarbridge-receiver', 'version': 1, 'nonce': request['nonce'], 'name': self.name,
                'port': self.https_port, 'certificateSha256': self.fingerprint,
                'pairing': self.pairing.status()['enabledUntil'] > 0}

    def run(self):
        window, count = time.monotonic(), 0
        while self.running:
            try:
                packet, address = self.socket.recvfrom(513)
                if time.monotonic() - window > 1:
                    window, count = time.monotonic(), 0
                count += 1
                if count > 30:
                    continue
                response = self.response(packet, address[0])
                if response:
                    self.socket.sendto(json.dumps(response, ensure_ascii=False).encode('utf-8'), address)
            except socket.timeout:
                pass
            except OSError:
                if self.running:
                    time.sleep(.1)

    def close(self):
        self.running = False
        self.socket.close()
        self.thread.join(2)
