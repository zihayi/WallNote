"""Create a receiver identity and export separate phone/WallNote pairing profiles."""
import argparse
import datetime as dt
import ipaddress
import json
import os
from pathlib import Path
import secrets
import socket

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parent


def private_ipv4(value):
    try:
        address = ipaddress.IPv4Address(value)
        return any(address in ipaddress.IPv4Network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'))
    except ipaddress.AddressValueError:
        return False


def local_address():
    candidates = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            # Selecting a route does not transmit a datagram.
            probe.connect(('192.0.2.1', 80))
            candidates.append(probe.getsockname()[0])
        except OSError:
            pass
    try:
        candidates.extend(item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    return next((value for value in candidates if private_ipv4(value)), None)


def atomic_json(file, value):
    temporary = file.with_suffix(file.suffix + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)


def setup(state_dir, host, port=8766):
    if not private_ipv4(host) or not 1 <= port <= 65535:
        raise ValueError('请指定有效的局域网 IPv4 地址和端口')
    state_dir = Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    config_file = state_dir / 'config.json'
    config = json.loads(config_file.read_text(encoding='utf-8')) if config_file.exists() else {
        'token': secrets.token_urlsafe(32), 'adminToken': secrets.token_urlsafe(32), 'bindHost': '0.0.0.0',
    }
    if not config.get('token') or not config.get('adminToken'):
        raise ValueError('现有配置缺少密钥，请检查备份，不会自动重置')
    certificate_file, key_file = state_dir / 'server.crt', state_dir / 'server.key'
    if certificate_file.exists() != key_file.exists():
        raise ValueError('现有证书或私钥缺失，不会覆盖或重新生成')
    if not certificate_file.exists():
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'CalendarBridge')])
        now = dt.datetime.now(dt.timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                       .serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(days=1))
                       .not_valid_after(now+dt.timedelta(days=1095))
                       .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                       .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1')), x509.IPAddress(ipaddress.ip_address(host))]), critical=False)
                       .sign(key, hashes.SHA256()))
        key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        certificate_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    certificate_pem = certificate_file.read_text(encoding='ascii')
    certificate = x509.load_pem_x509_certificate(certificate_pem.encode('ascii'))
    fingerprint = certificate.fingerprint(hashes.SHA256()).hex()
    config.update(port=port, server=f'https://{host}:{port}')
    atomic_json(config_file, config)
    atomic_json(state_dir / 'pairing.json', {'schemaVersion': 1, 'type': 'calendarbridge-phone', 'server': config['server'], 'token': config['token'], 'certificateSha256': fingerprint})
    atomic_json(state_dir / 'wallnote-connection.json', {'schemaVersion': 1, 'type': 'calendarbridge-desktop', 'baseUrl': f'https://127.0.0.1:{port}', 'adminToken': config['adminToken'], 'certificatePem': certificate_pem, 'certificateSha256': fingerprint})
    return config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', help='电脑局域网 IPv4 地址，默认自动检测')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--state-dir', type=Path, default=ROOT / 'state')
    args = parser.parse_args()
    host = args.host or local_address()
    if not host:
        parser.error('未检测到局域网地址，请使用 --host 指定')
    setup(args.state_dir, host, args.port)
    print(f'接收地址：https://{host}:{args.port}')
    print('手机配对文件：', args.state_dir / 'pairing.json')
    print('WallNote 连接配置：', args.state_dir / 'wallnote-connection.json')
    print('配对文件包含访问密钥，请仅交给自己的设备。')


if __name__ == '__main__':
    main()
