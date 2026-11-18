"""Durable, idempotent create/update queue for one paired Android device."""
import hashlib
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

EVENT_FIELDS = ('calendar_id', 'title', 'dtstart', 'dtend', 'duration', 'eventTimezone', 'allDay',
                'eventLocation', 'description', 'rrule', 'rdate', 'exrule', 'exdate',
                'original_id', 'originalInstanceTime', 'originalAllDay', 'eventStatus', 'deleted')
EDIT_FIELDS = {'title', 'dtstart', 'dtend', 'eventTimezone', 'allDay', 'eventLocation', 'description'}


def checked_fields(value, creating=False):
    if not isinstance(value, dict) or not value or set(value) - EDIT_FIELDS:
        raise ValueError('仅支持标题、时间、地点和备注字段')
    if creating and not {'title', 'dtstart', 'dtend', 'eventTimezone', 'allDay'} <= set(value):
        raise ValueError('缺少新增日程的必要字段')
    for key, item in value.items():
        if key in ('dtstart', 'dtend'):
            if type(item) is not int or not -2208988800000 <= item <= 7258118400000:
                raise ValueError('时间超出 1900—2200 年范围')
        elif key == 'allDay':
            if type(item) is not int or item not in (0, 1):
                raise ValueError('全天标记无效')
        elif not isinstance(item, str) or len(item) > (20000 if key == 'description' else 1000):
            raise ValueError('文本字段格式或长度无效')
    if 'title' in value and not value['title'].strip():
        raise ValueError('标题不能为空')
    return dict(value)


def prepare_command(request, snapshot):
    if not isinstance(request, dict) or request.get('action') not in ('create', 'update'):
        raise ValueError('仅支持新增和修改日程')
    command_id = str(uuid.UUID(request.get('id', '')))
    action = request['action']
    fields = checked_fields(request.get('changes'), action == 'create')
    client_id = snapshot.get('clientId')
    if not client_id:
        raise ValueError('请先在手机同步一次')
    command = {'id': command_id, 'action': action, 'changes': fields, 'clientId': client_id}
    if action == 'create':
        calendar_id = str(request.get('calendarId', ''))
        calendar = next((c for c in snapshot['calendars'] if str(c['_id']) == calendar_id), None)
        if not calendar or int(calendar.get('calendar_access_level') or 0) < 500:
            raise ValueError('请选择可写日历')
        if not calendar.get('visible', 1):
            raise ValueError('请选择手机中可见的日历')
        command['calendarId'] = int(calendar_id)
        merged = fields
    else:
        event_id = str(request.get('eventId', ''))
        event = next((e for e in snapshot['events'] if str(e['_id']) == event_id), None)
        expected = request.get('expected')
        if not event or not isinstance(expected, dict):
            raise ValueError('日程不存在，请刷新后重试')
        if any(event.get(k) != expected.get(k) for k in EVENT_FIELDS):
            raise ValueError('日程已更新，请重新打开编辑')
        calendar = next((c for c in snapshot['calendars'] if str(c['_id']) == str(event['calendar_id'])), None)
        if not calendar or int(calendar.get('calendar_access_level') or 0) < 500:
            raise ValueError('此日历不可编辑')
        command.update(eventId=int(event_id), expected={k: event.get(k) for k in EVENT_FIELDS})
        merged = dict(event, **fields)
    start, end = merged.get('dtstart'), merged.get('dtend')
    if start is not None and end is not None and end <= start:
        raise ValueError('结束时间必须晚于开始时间')
    if merged.get('allDay') == 1:
        if any(v is not None and v % 86400000 != 0 for v in (start, end)):
            raise ValueError('全天事件需要 UTC 日期边界')
        fields['eventTimezone'] = 'UTC'
    if action == 'update' and (merged.get('rrule') or merged.get('rdate')) and ('dtstart' in fields or 'dtend' in fields):
        if end is None:
            raise ValueError('修改重复事件时间需要开始和结束时间')
        fields['duration'] = 'P%dD' % ((end-start)//86400000) if merged.get('allDay') else 'PT%dS' % ((end-start)//1000)
        fields['dtend'] = None
    if 'reminders' in request:
        reminders = request['reminders']
        if not isinstance(reminders, list) or len(reminders) > 5 or any(type(m) is not int or not 0 <= m <= 40320 for m in reminders) or len(set(reminders)) != len(reminders):
            raise ValueError('提醒需为 0—40320 分钟的整数，最多 5 个且不能重复')
        maximum = calendar.get('maxReminders')
        if maximum is not None and int(maximum) >= 0 and len(reminders) > int(maximum):
            raise ValueError('超过此日历允许的提醒数量')
        command['reminders'] = reminders
        if action == 'update':
            current = [{k: r.get(k) for k in ('_id', 'minutes', 'method')} for r in snapshot['reminders'] if str(r.get('event_id')) == event_id]
            if request.get('expectedReminders') != current:
                raise ValueError('提醒已更新，请重新打开编辑')
            command['expectedReminders'] = current
    return command


class CommandStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,result TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS device (id INTEGER PRIMARY KEY CHECK(id=1),info TEXT NOT NULL,seen REAL NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1),client TEXT NOT NULL)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def register_device(self, info):
        if not isinstance(info, dict) or not isinstance(info.get('clientId'), str) or not 1 <= len(info['clientId']) <= 128 or type(info.get('canWrite')) is not bool:
            raise ValueError('Invalid device status')
        clean = {k: info.get(k) for k in ('clientId', 'canWrite', 'appVersion', 'device')}
        clean['device'] = str(clean.get('device') or '')[:200]
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            bound = db.execute('SELECT client FROM binding WHERE id=1').fetchone()
            if bound and bound[0] != info['clientId']:
                raise ValueError('此服务已绑定另一台手机，请使用独立接收配置')
            db.execute('INSERT OR IGNORE INTO binding VALUES (1,?)', (info['clientId'],))
            db.execute('INSERT OR REPLACE INTO device VALUES (1,?,?)', (json.dumps(clean), time.time()))

    def bound_client(self):
        with self.connect() as db:
            row = db.execute('SELECT client FROM binding WHERE id=1').fetchone()
        return row[0] if row else None

    def submit(self, request, snapshot):
        command_id = str(uuid.UUID(request.get('id', '')))
        digest = hashlib.sha256(json.dumps(request, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT payload FROM commands WHERE id=?', (command_id,)).fetchone()
            if old:
                if json.loads(old[0]).get('requestHash') != digest:
                    raise ValueError('提交标识已用于另一条修改')
                return command_id
            command = prepare_command(request, snapshot)
            command['requestHash'] = digest
            now = time.time()
            db.execute('INSERT INTO commands VALUES (?,?,?,?,?,NULL)', (command_id, json.dumps(command, ensure_ascii=False, sort_keys=True), 'queued', now, now))
        return command_id

    def next(self, info):
        self.register_device(info)
        now = time.time()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("UPDATE commands SET state='failed',updated=?,result=? WHERE state='queued' AND created<?", (now, json.dumps({'status': 'failed', 'message': '超过 24 小时未执行，请重新提交'}), now-86400))
            if not info['canWrite']:
                return None
            rows = db.execute("SELECT id,payload FROM commands WHERE state IN ('queued','delivered') ORDER BY CASE state WHEN 'delivered' THEN 0 ELSE 1 END,created").fetchall()
            row = next((r for r in rows if json.loads(r[1]).get('clientId') == info['clientId']), None)
            if not row:
                return None
            db.execute("UPDATE commands SET state='delivered',updated=? WHERE id=?", (now, row[0]))
            return json.loads(row[1])

    def finish(self, result):
        if not isinstance(result, dict) or result.get('status') not in ('succeeded', 'failed', 'uncertain'):
            raise ValueError('Invalid result')
        clean = {k: result.get(k) for k in ('id', 'status', 'eventId', 'message')}
        clean['message'] = str(clean['message'] or '')[:2000]
        encoded = json.dumps(clean, ensure_ascii=False, sort_keys=True)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT state,result,payload FROM commands WHERE id=?', (result.get('id'),)).fetchone()
            if not old:
                raise ValueError('Unknown command')
            if result.get('clientId') != json.loads(old[2]).get('clientId'):
                raise ValueError('Wrong device')
            if old[0] != 'delivered':
                if old[1] == encoded:
                    return
                raise ValueError('Command is not awaiting a result')
            db.execute('UPDATE commands SET state=?,updated=?,result=? WHERE id=?', (result['status'], time.time(), encoded, result['id']))

    def cancel(self, command_id):
        with self.connect() as db:
            count = db.execute("UPDATE commands SET state='cancelled',updated=? WHERE id=? AND state='queued'", (time.time(), command_id)).rowcount
            if count != 1:
                raise ValueError('手机已领取此操作，不能撤回；请等待执行结果')

    @staticmethod
    def record(row):
        return dict(id=row[0], command=json.loads(row[1]), state=row[2], created=row[3], updated=row[4], result=json.loads(row[5]) if row[5] else None)

    def get(self, command_id):
        with self.connect() as db:
            row = db.execute('SELECT id,payload,state,created,updated,result FROM commands WHERE id=?', (str(uuid.UUID(command_id)),)).fetchone()
        return self.record(row) if row else None

    def status(self):
        with self.connect() as db:
            rows = db.execute('SELECT id,payload,state,created,updated,result FROM commands ORDER BY created DESC LIMIT 100').fetchall()
            device = db.execute('SELECT info,seen FROM device WHERE id=1').fetchone()
        return {'commands': [self.record(row) for row in rows], 'device': dict(json.loads(device[0]), lastSeen=device[1]) if device else None}
