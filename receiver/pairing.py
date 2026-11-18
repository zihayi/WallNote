"""Short-lived, locally approved pairing. Discovery never grants access."""
import hashlib
import hmac
import re
import secrets
import threading
import time


def verification_code(identity, fingerprint, nonce, secret):
    transcript = '\0'.join(('CalendarBridge-pair-v1', identity, fingerprint, nonce, secret))
    return '%06d' % (int.from_bytes(hashlib.sha256(transcript.encode('ascii')).digest()[:4], 'big') % 1000000)


class PairingManager:
    def __init__(self, fingerprint, token, commands, clock=time.time):
        self.fingerprint, self.token, self.commands, self.clock = fingerprint, token, commands, clock
        self.lock = threading.RLock()
        self.until = 0
        self.requests = {}
        self.attempts = 0

    def open(self):
        with self.lock:
            self.until = self.clock() + 120
            self.requests.clear()
            self.attempts = 0
            return self.status()

    def status(self):
        with self.lock:
            now = self.clock()
            self.requests = {key: value for key, value in self.requests.items() if value['expires'] > now}
            return {'enabledUntil': self.until if self.until > now else 0,
                    'requests': [{'id': key, 'device': value['device'], 'code': value['code'], 'expires': value['expires']}
                                 for key, value in self.requests.items() if value['state'] == 'waiting']}

    def begin(self, data, peer):
        with self.lock:
            if self.clock() >= self.until:
                raise ValueError('请先在 WallNote 点击“配对手机”')
            commitment, client = data.get('commitment'), data.get('clientId')
            if not isinstance(commitment, str) or not re.fullmatch('[0-9a-f]{64}', commitment) or not isinstance(client, str) or not 1 <= len(client) <= 128:
                raise ValueError('配对请求无效')
            bound_client = self.commands.bound_client()
            if bound_client and bound_client != client:
                raise ValueError('此接收服务已绑定另一台手机')
            for key, value in self.requests.items():
                if value['commitment'] == commitment and value['clientId'] == client and value['peer'] == peer and value['expires'] > self.clock():
                    return {'id': key, 'nonce': value['nonce'], 'expires': value['expires']}
            if self.attempts >= 8:
                raise ValueError('配对请求过多，请在电脑重新开启配对')
            self.attempts += 1
            key = secrets.token_hex(16)
            value = {'commitment': commitment, 'clientId': client, 'peer': peer, 'device': str(data.get('device') or 'Android 手机')[:100],
                     'nonce': secrets.token_hex(32), 'expires': self.until, 'state': 'committed', 'code': ''}
            self.requests[key] = value
            return {'id': key, 'nonce': value['nonce'], 'expires': value['expires']}

    def _request(self, data, peer):
        key, secret = data.get('id'), data.get('secret')
        value = self.requests.get(key) if isinstance(key, str) else None
        if not value or value['expires'] <= self.clock() or value['peer'] != peer or not isinstance(secret, str) or not re.fullmatch('[0-9a-f]{64}', secret):
            raise ValueError('配对已过期，请重新搜索电脑')
        if not hmac.compare_digest(hashlib.sha256(secret.encode('ascii')).hexdigest(), value['commitment']):
            raise ValueError('配对证明无效')
        return key, secret, value

    def reveal(self, data, peer):
        with self.lock:
            key, secret, value = self._request(data, peer)
            if value['state'] == 'committed':
                value['code'] = verification_code(key, self.fingerprint, value['nonce'], secret)
                value['state'] = 'waiting'
            # The phone computes the code independently, using the TLS certificate it pinned.
            return {'state': value['state']}

    def decide(self, identity, approve):
        with self.lock:
            value = self.requests.get(identity) if isinstance(identity, str) else None
            if not value or value['expires'] <= self.clock() or value['state'] != 'waiting':
                raise ValueError('配对请求已失效')
            if approve:
                self.commands.register_device({'clientId': value['clientId'], 'device': value['device'], 'appVersion': 4, 'canWrite': False})
                value['state'] = 'approved'
                self.until = 0
                for key, other in self.requests.items():
                    if key != identity:
                        other['state'] = 'rejected'
            else:
                value['state'] = 'rejected'
            return self.status()

    def finish(self, data, peer):
        with self.lock:
            _, _, value = self._request(data, peer)
            if value['state'] == 'approved':
                return {'state': 'approved', 'token': self.token, 'certificateSha256': self.fingerprint}
            return {'state': value['state']}
