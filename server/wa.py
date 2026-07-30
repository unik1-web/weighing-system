from datetime import datetime

from dictionary_import import _dedupe_vehicle_records
from text_encoding import (
    format_person_name,
    format_vehicle_brand,
    format_vehicle_plate,
    is_readable_name,
)

DEFAULT_LABEL = '—'

try:
    import pymysql
    from pymysql.cursors import DictCursor
except ImportError:  # pragma: no cover
    pymysql = None
    DictCursor = None


def _require_pymysql():
    if pymysql is None:
        raise RuntimeError(
            'Модуль pymysql не установлен. Выполните: pip install pymysql'
        )


def connect_wa(host: str, port: int, database: str, user: str, password: str):
    _require_pymysql()
    return pymysql.connect(
        host=host.strip() or '127.0.0.1',
        port=port or 3306,
        user=user.strip(),
        password=password or '',
        database=database.strip() or 'wa',
        charset='utf8mb4',
        cursorclass=DictCursor,
        connect_timeout=8,
        read_timeout=30,
        write_timeout=30,
    )


def _format_datetime(value) -> str:
    if value is None:
        return ''
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    return str(value).strip()


def _clean_name(value) -> str:
    text = str(value or '').strip()
    if not text or not is_readable_name(text):
        return ''
    return text


def _weight_kg(value) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return round(number)


def _vehicle_brand(brand, model) -> str:
    parts = [str(brand or '').strip(), str(model or '').strip()]
    return format_vehicle_brand(' '.join(part for part in parts if part))


def _fetch_company_names(cursor, role_column: str) -> list[str]:
    cursor.execute(
        f'''
        SELECT DISTINCT c.name AS name
        FROM autob a
        JOIN lst_companies c ON c.id = a.{role_column}
        WHERE a.deletedatetime IS NULL
          AND c.name IS NOT NULL
          AND TRIM(c.name) <> ''
          AND (c.disabled = 0 OR c.disabled IS NULL)
        ORDER BY c.name
        ''',
    )
    return [_clean_name(row['name']) for row in cursor.fetchall() if _clean_name(row.get('name'))]


def _fetch_vehicle_records(cursor) -> list[dict]:
    records: list[dict] = []

    cursor.execute(
        '''
        SELECT n.num AS num, t.brand AS brand, t.model AS model
        FROM lst_autonums n
        LEFT JOIN lst_autotypes t ON t.id = n.autotypeid
        WHERE (n.disabled = 0 OR n.disabled IS NULL)
          AND n.num IS NOT NULL
          AND TRIM(n.num) <> ''
        ''',
    )
    for row in cursor.fetchall():
        number = format_vehicle_plate(str(row.get('num') or ''))
        if not number:
            continue
        records.append({
            'number': number,
            'brand': _vehicle_brand(row.get('brand'), row.get('model')),
            'tare_kg': None,
        })

    cursor.execute(
        '''
        SELECT DISTINCT a.autonum AS num, t.brand AS brand, t.model AS model
        FROM autob a
        LEFT JOIN lst_autotypes t ON t.id = a.autotypeid
        WHERE a.deletedatetime IS NULL
          AND a.autonum IS NOT NULL
          AND TRIM(a.autonum) <> ''
        ''',
    )
    for row in cursor.fetchall():
        number = format_vehicle_plate(str(row.get('num') or ''))
        if not number:
            continue
        records.append({
            'number': number,
            'brand': _vehicle_brand(row.get('brand'), row.get('model')),
            'tare_kg': None,
        })

    return _dedupe_vehicle_records(records)


def test_wa_connection(host: str, port: int, database: str, user: str, password: str) -> int:
    conn = connect_wa(host, port, database, user, password)
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                '''
                SELECT COUNT(*) AS cnt
                FROM autob
                WHERE deletedatetime IS NULL
                ''',
            )
            row = cursor.fetchone() or {}
            return int(row.get('cnt') or 0)
    finally:
        conn.close()


def fetch_wa_dictionaries(host: str, port: int, database: str, user: str, password: str) -> dict[str, list]:
    conn = connect_wa(host, port, database, user, password)
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                '''
                SELECT name FROM lst_drivers
                WHERE name IS NOT NULL AND TRIM(name) <> ''
                  AND (disabled = 0 OR disabled IS NULL)
                ORDER BY name
                ''',
            )
            drivers = [
                format_person_name(_clean_name(row['name']))
                for row in cursor.fetchall()
                if _clean_name(row.get('name'))
            ]

            cursor.execute(
                '''
                SELECT name FROM lst_cargotypes
                WHERE name IS NOT NULL AND TRIM(name) <> ''
                  AND (disabled = 0 OR disabled IS NULL)
                ORDER BY name
                ''',
            )
            cargos = [_clean_name(row['name']) for row in cursor.fetchall() if _clean_name(row.get('name'))]

            shippers = _fetch_company_names(cursor, 'supplierid')
            receivers = _fetch_company_names(cursor, 'recipientid')
            carriers = _fetch_company_names(cursor, 'carrierid')
            vehicles = _fetch_vehicle_records(cursor)

            return {
                'cargos': sorted(set(cargos), key=str.casefold),
                'receivers': sorted(set(receivers), key=str.casefold),
                'shippers': sorted(set(shippers), key=str.casefold),
                'carriers': sorted(set(carriers), key=str.casefold),
                'vehicles': sorted(vehicles, key=lambda item: str(item.get('number', '')).casefold()),
                'drivers': sorted(set(drivers), key=str.casefold),
            }
    finally:
        conn.close()


def fetch_wa_items(host: str, port: int, database: str, user: str, password: str, date_str: str) -> list[dict]:
    target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    conn = connect_wa(host, port, database, user, password)
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                '''
                SELECT
                    a.uid,
                    a.bdatetime,
                    a.taredatetime,
                    a.autonum,
                    at.brand AS autotype_brand,
                    at.model AS autotype_model,
                    a.brutto,
                    a.tare,
                    a.netto,
                    ct.name AS cargo_name,
                    sup.name AS shipper_name,
                    rec.name AS receiver_name,
                    car.name AS carrier_name,
                    dr.name AS driver_name,
                    op.name AS operator_name,
                    a.invoicenum,
                    a.actnum
                FROM autob a
                LEFT JOIN lst_autotypes at ON at.id = a.autotypeid
                LEFT JOIN lst_cargotypes ct ON ct.id = a.cargotypeid
                LEFT JOIN lst_companies sup ON sup.id = a.supplierid
                LEFT JOIN lst_companies rec ON rec.id = a.recipientid
                LEFT JOIN lst_companies car ON car.id = a.carrierid
                LEFT JOIN lst_drivers dr ON dr.id = a.driverid
                LEFT JOIN lst_operators op ON op.id = a.operatorid
                WHERE a.deletedatetime IS NULL
                  AND (
                    DATE(a.bdatetime) = %s
                    OR DATE(a.taredatetime) = %s
                  )
                ORDER BY a.bdatetime, a.autonum
                ''',
                (target_date, target_date),
            )
            items: list[dict] = []
            for row in cursor.fetchall():
                gross = _weight_kg(row.get('brutto'))
                if gross is None:
                    continue

                tare = _weight_kg(row.get('tare'))
                net = _weight_kg(row.get('netto'))
                if net is None and tare is not None:
                    net = max(0.0, round(gross - tare))

                vehicle_number = format_vehicle_plate(str(row.get('autonum') or ''))
                if not vehicle_number:
                    continue

                invoice = str(row.get('invoicenum') or '').strip()
                actnum = row.get('actnum')
                notes_parts = []
                if actnum:
                    notes_parts.append(f'Акт: {actnum}')
                if invoice:
                    notes_parts.append(f'Накладная: {invoice}')

                items.append({
                    'wa_uid': str(row.get('uid') or ''),
                    'datetimebrutto': _format_datetime(row.get('bdatetime')),
                    'datetimetara': _format_datetime(row.get('taredatetime')),
                    'vehicle_number': vehicle_number,
                    'vehicle_brand': _vehicle_brand(row.get('autotype_brand'), row.get('autotype_model')),
                    'driver_name': format_person_name(_clean_name(row.get('driver_name'))) or DEFAULT_LABEL,
                    'cargo_name': _clean_name(row.get('cargo_name')) or DEFAULT_LABEL,
                    'shipper_name': _clean_name(row.get('shipper_name')) or DEFAULT_LABEL,
                    'receiver_name': _clean_name(row.get('receiver_name')) or DEFAULT_LABEL,
                    'carrier_name': _clean_name(row.get('carrier_name')) or DEFAULT_LABEL,
                    'gross_weight': gross,
                    'tare_weight': tare,
                    'net_weight': net,
                    'operator_name': _clean_name(row.get('operator_name')) or 'Импорт WA',
                    'invoice': invoice,
                    'actnum': int(actnum) if actnum is not None else None,
                    'notes': '. '.join(notes_parts),
                })
            return items
    finally:
        conn.close()
