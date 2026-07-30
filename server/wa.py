"""Import weighings from WA («Весы Авто» / Server Auto) Firebird database.

Default install path on user machines: C:\\Program Files (x86)\\WA
Also resolves VesySoft layouts: ...\\DataBase\\VESYEVENT.GDB
"""

from __future__ import annotations

import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime
from typing import Any

from persistence import get_app_root
from text_encoding import (
    decode_db_text,
    format_person_name,
    format_vehicle_brand,
    format_vehicle_plate,
    is_readable_name,
    is_readable_vehicle_number,
    split_person_names,
)

try:
    import fdb
except ImportError:  # pragma: no cover
    fdb = None

FIREBIRD_CHARSET = 'WIN1251'
DEFAULT_LABEL = '—'
DEFAULT_USER = 'SYSDBA'
DEFAULT_PASSWORD = 'masterkey'

DEFAULT_WA_PATHS = (
    r'C:\Program Files (x86)\WA',
    r'C:\Program Files\WA',
    r'C:\Program Files (x86)\VesySoft\Server',
    r'C:\Program Files\VesySoft\Server',
    r'C:\VesySoft\Server',
)

DB_FILE_CANDIDATES = (
    'VESYEVENT.GDB',
    'VESYEVENT.FDB',
    'vesyevent.gdb',
    'vesyevent.fdb',
    'WA.GDB',
    'WA.FDB',
    'Data.GDB',
    'Data.FDB',
)

WEIGHT_TABLE_CANDIDATES = (
    'SP_DOC',
    'SP_DOCS',
    'SP_VSV',
    'SP_REG',
    'DOCUMENTS',
    'DOCUMENT',
    'REG_DOC',
    'REG_VSV',
    'VW_SP_DOC',
    'VW_DOCUMENTS',
    'VW_SP_REG',
    'DOCS',
)

VEHICLE_FIELD_CANDIDATES = (
    'NOMERTS',
    'NOMER_TS',
    'NOMER',
    'CAR_NUMBER',
    'NUMERTS',
    'VEHICLE_NUMBER',
    'GOSNUMBER',
    'GOSNOMER',
)

REGION_FIELD_CANDIDATES = (
    'REGIONTS',
    'REGION_TS',
    'REGION',
    'REGTS',
    'REG_TS',
)

BRAND_FIELD_CANDIDATES = (
    'MARKATS',
    'MARKA_TS',
    'MARKA',
    'CAR_MARKA',
    'BRAND',
)

DRIVER_FIELD_CANDIDATES = (
    'VODITEL',
    'DRIVER',
    'FIO_VODITEL',
    'DRIVER_NAME',
)

CARGO_FIELD_CANDIDATES = (
    'GRUZ',
    'CARGO',
    'NOMENCLATURE',
    'PRODUCT',
    'GRUZ_NAME',
)

SHIPPER_FIELD_CANDIDATES = (
    'OTPRAVITEL',
    'SENDER',
    'SHIPPER',
    'OTPR',
)

RECEIVER_FIELD_CANDIDATES = (
    'POLUCHATEL',
    'RECEIVER',
    'POLUCH',
    'FIRMA_POL',
)

CARRIER_FIELD_CANDIDATES = (
    'PEREVOZCHIK',
    'CARRIER',
    'TRANSPORTNIK',
)

TRAILER_FIELD_CANDIDATES = (
    'NOMERPRICEP',
    'NOMER_PRICEP',
    'TRAILER',
    'TRAILER_NUMBER',
    'PRICEP',
)

GROSS_FIELD_CANDIDATES = (
    'MASSA_BRUTTO',
    'BRUTTO',
    'GROSS',
    'BRUTTO_KG',
    'WEIGHT_BRUTTO',
)

TARE_FIELD_CANDIDATES = (
    'MASSA_TARA',
    'TARA',
    'TARE',
    'TARA_KG',
    'WEIGHT_TARA',
)

NET_FIELD_CANDIDATES = (
    'MASSA_NETTO',
    'NETTO',
    'NET',
    'NETTO_KG',
    'WEIGHT_NETTO',
)

ID_FIELD_CANDIDATES = (
    'GUIDDOC',
    'GUID',
    'CODE',
    'ID',
    'DOC_ID',
    'NOMERDOC',
    'DOCNUMBER',
)

OPERATOR_FIELD_CANDIDATES = (
    'USERNAME',
    'USER_NAME',
    'OPERATOR',
    'IMYA_POLZOVATELYA',
    'USER_BASA',
)

DELETED_FIELD_CANDIDATES = (
    'FDELETE',
    'DELETED',
    'FLAG_DELETE',
    'IS_DELETED',
    'UDALEN',
)

DATE_BRUTTO_CANDIDATES = (
    'DATE_BRUTTO',
    'DATEBRUTTO',
    'D_BRUTTO',
    'DATABRUTIROVANIYA',
    'DATE_DOC',
    'DATEDOC',
    'DOC_DATE',
    'DATETIME_BRUTTO',
    'DATETIMEBRUTTO',
    'WEIGHINGSTART_DATETIME',
    'DATETIME_CREATE',
    'DATETIME_UPDATE',
    'DATETIME',
)

TIME_BRUTTO_CANDIDATES = (
    'TIME_BRUTTO',
    'TIMEBRUTTO',
    'T_BRUTTO',
    'VREMYABRUTIROVANIYA',
    'TIME_DOC',
    'TIMEDOC',
    'DOC_TIME',
)

DATE_TARE_CANDIDATES = (
    'DATE_TARA',
    'DATETARA',
    'D_TARA',
    'DATATARIROVANIYA',
    'DATETIME_TARA',
    'DATETIMETARA',
)

TIME_TARE_CANDIDATES = (
    'TIME_TARA',
    'TIMETARA',
    'T_TARA',
    'VREMYATARIROVANIYA',
)


def _close_connection(conn) -> None:
    try:
        conn.commit()
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass


def connect_wa(db_path: str, user: str = DEFAULT_USER, password: str = DEFAULT_PASSWORD):
    if fdb is None:
        raise RuntimeError(
            'Модуль fdb не установлен. Используйте Python 3.11/3.12: pip install -r server/requirements.txt'
        )
    return fdb.connect(
        dsn=db_path.strip().replace('\\', '/'),
        user=user or DEFAULT_USER,
        password=password or DEFAULT_PASSWORD,
        charset=FIREBIRD_CHARSET,
    )


def connect_wa_with_timeout(
    db_path: str,
    user: str = DEFAULT_USER,
    password: str = DEFAULT_PASSWORD,
    timeout_seconds: float = 8.0,
):
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(connect_wa, db_path, user, password)
        try:
            return future.result(timeout=timeout_seconds)
        except FutureTimeoutError as exc:
            raise TimeoutError(f'Таймаут подключения к базе WA: {db_path}') from exc


def resolve_wa_install_dir(db_path: str) -> str:
    cleaned = db_path.strip()
    if not cleaned:
        return ''

    if os.path.isabs(cleaned):
        resolved = cleaned
    else:
        resolved = os.path.join(get_app_root(), cleaned.replace('/', os.sep))

    if os.path.isdir(resolved):
        return resolved
    if os.path.isfile(resolved):
        return os.path.dirname(resolved)
    return resolved


def _candidate_db_files(root: str) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()

    def add(path: str) -> None:
        normalized = os.path.abspath(path)
        key = normalized.casefold()
        if key in seen or not os.path.isfile(normalized):
            return
        seen.add(key)
        paths.append(normalized)

    if not root:
        return paths

    if os.path.isfile(root):
        add(root)
        return paths

    for name in DB_FILE_CANDIDATES:
        add(os.path.join(root, name))
        add(os.path.join(root, 'DataBase', name))
        add(os.path.join(root, 'Database', name))
        add(os.path.join(root, 'DB', name))
        add(os.path.join(root, 'Data', name))

    for folder_name in ('DataBase', 'Database', 'DB', 'Data', 'BIN', 'BIN20'):
        folder = os.path.join(root, folder_name)
        if not os.path.isdir(folder):
            continue
        try:
            for entry in os.listdir(folder):
                lower = entry.casefold()
                if lower.endswith(('.gdb', '.fdb', '.db', '.sqlite', '.sqlite3')):
                    add(os.path.join(folder, entry))
        except OSError:
            continue

    try:
        for entry in os.listdir(root):
            lower = entry.casefold()
            if lower.endswith(('.gdb', '.fdb')):
                add(os.path.join(root, entry))
    except OSError:
        pass

    return paths


def resolve_wa_db_path(db_path: str) -> str:
    cleaned = db_path.strip()
    if cleaned and os.path.isfile(cleaned):
        return os.path.abspath(cleaned)

    install_dir = resolve_wa_install_dir(cleaned)
    candidates = _candidate_db_files(install_dir) if install_dir else []

    if not candidates and not cleaned:
        for default_root in DEFAULT_WA_PATHS:
            candidates.extend(_candidate_db_files(default_root))

    for path in candidates:
        lower = path.casefold()
        if lower.endswith(('vesyevent.gdb', 'vesyevent.fdb', 'wa.gdb', 'wa.fdb')):
            return path

    firebird = [path for path in candidates if path.casefold().endswith(('.gdb', '.fdb'))]
    if firebird:
        return firebird[0]

    if candidates:
        return candidates[0]

    raise FileNotFoundError(
        f'В каталоге WA не найден файл базы (VESYEVENT.GDB / *.fdb / *.gdb): {install_dir or db_path}'
    )


def _table_exists(cursor, table_name: str) -> bool:
    try:
        cursor.execute(
            """
            SELECT 1
            FROM RDB$RELATIONS
            WHERE RDB$RELATION_NAME = ?
            """,
            (table_name.upper(),),
        )
        return cursor.fetchone() is not None
    except Exception:
        return False


def _table_columns(cursor, table_name: str) -> set[str]:
    if not _table_exists(cursor, table_name):
        return set()
    cursor.execute(
        """
        SELECT TRIM(RDB$FIELD_NAME)
        FROM RDB$RELATION_FIELDS
        WHERE RDB$RELATION_NAME = ?
        ORDER BY RDB$FIELD_POSITION
        """,
        (table_name.upper(),),
    )
    return {str(row[0]).upper() for row in cursor.fetchall() if row and row[0]}


def _list_user_tables(cursor) -> list[str]:
    cursor.execute(
        """
        SELECT TRIM(RDB$RELATION_NAME)
        FROM RDB$RELATIONS
        WHERE RDB$SYSTEM_FLAG = 0
          AND RDB$VIEW_BLR IS NULL
        ORDER BY 1
        """
    )
    return [str(row[0]).upper() for row in cursor.fetchall() if row and row[0]]


def _pick_column(columns: set[str], *names: str) -> str | None:
    upper_map = {name.upper(): name.upper() for name in columns}
    for name in names:
        if name.upper() in upper_map:
            return upper_map[name.upper()]
    return None


def _find_weighing_table(cursor) -> tuple[str, set[str]]:
    ordered: list[str] = []
    seen: set[str] = set()
    for name in WEIGHT_TABLE_CANDIDATES:
        key = name.upper()
        if key not in seen and _table_exists(cursor, key):
            seen.add(key)
            ordered.append(key)
    for name in _list_user_tables(cursor):
        if name not in seen:
            seen.add(name)
            ordered.append(name)

    best: tuple[str, set[str], int] | None = None
    for table in ordered:
        columns = _table_columns(cursor, table)
        if not columns:
            continue
        score = 0
        if _pick_column(columns, *VEHICLE_FIELD_CANDIDATES):
            score += 3
        if _pick_column(columns, *GROSS_FIELD_CANDIDATES):
            score += 3
        if _pick_column(columns, *TARE_FIELD_CANDIDATES):
            score += 2
        if _pick_column(columns, *NET_FIELD_CANDIDATES):
            score += 2
        if _pick_column(columns, *DATE_BRUTTO_CANDIDATES):
            score += 2
        if score >= 6 and (best is None or score > best[2]):
            best = (table, columns, score)

    if best is None:
        raise FileNotFoundError(
            'В базе WA не найдена таблица журнала взвешиваний '
            '(ожидаются поля госномера и брутто/нетто)'
        )
    return best[0], best[1]


def _clean_name(value) -> str:
    text = decode_db_text(value)
    if not text or text in {DEFAULT_LABEL, '-', ''}:
        return ''
    if not is_readable_name(text):
        return ''
    return text


def _weight_to_kg(value) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(',', '.')
    if not text:
        return None
    try:
        number = float(text)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    if number < 100:
        number *= 1000
    return round(number)


def _format_datetime(value) -> str:
    if value is None:
        return ''
    if hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    text = str(value).strip()
    if not text:
        return ''
    for fmt in (
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%dT%H:%M:%S',
        '%d.%m.%Y %H:%M:%S',
        '%d.%m.%Y %H:%M',
        '%d.%m.%Y',
        '%Y-%m-%d',
    ):
        try:
            return datetime.strptime(text[:19], fmt).strftime('%Y-%m-%d %H:%M:%S')
        except ValueError:
            continue
    return text


def _combine_date_time(date_value, time_value) -> str:
    date_text = _format_datetime(date_value)
    if not date_text:
        return ''
    if ' ' in date_text and date_text[10:11] == ' ':
        if time_value is None or str(time_value).strip() == '':
            return date_text
    time_text = ''
    if time_value is not None:
        if hasattr(time_value, 'strftime'):
            time_text = time_value.strftime('%H:%M:%S')
        else:
            raw = str(time_value).strip()
            if raw:
                if ' ' in raw:
                    raw = raw.split(' ')[-1]
                time_text = raw[:8]
                if len(time_text) == 5:
                    time_text = f'{time_text}:00'
    date_part = date_text[:10]
    return f'{date_part} {time_text}' if time_text else date_part


def _parse_target_date(date_str: str):
    return datetime.strptime(date_str, '%Y-%m-%d').date()


def _row_matches_date(datetime_brutto: str, datetime_tara: str, target) -> bool:
    for value in (datetime_brutto, datetime_tara):
        if not value:
            continue
        try:
            record_date = datetime.strptime(value[:10], '%Y-%m-%d').date()
        except ValueError:
            continue
        if record_date == target:
            return True
    return False


def _is_deleted(value) -> bool:
    if value is None:
        return False
    text = str(value).strip().casefold()
    return text in {'1', 'true', 't', 'y', 'yes', 'удален', 'удалён'}


def _vehicle_number(number_value, region_value) -> str:
    number = format_vehicle_plate(decode_db_text(number_value))
    region = decode_db_text(region_value).strip()
    if number and region and not any(ch.isdigit() for ch in number[-2:]):
        combined = format_vehicle_plate(f'{number}{region}')
        return combined or number or DEFAULT_LABEL
    return number or DEFAULT_LABEL


def _fetch_firebird_items(db_path: str, date_str: str, user: str, password: str) -> list[dict]:
    conn = connect_wa_with_timeout(db_path, user, password)
    cursor = conn.cursor()
    try:
        table, columns = _find_weighing_table(cursor)
        mapping = {
            'id': _pick_column(columns, *ID_FIELD_CANDIDATES),
            'vehicle': _pick_column(columns, *VEHICLE_FIELD_CANDIDATES),
            'region': _pick_column(columns, *REGION_FIELD_CANDIDATES),
            'brand': _pick_column(columns, *BRAND_FIELD_CANDIDATES),
            'driver': _pick_column(columns, *DRIVER_FIELD_CANDIDATES),
            'cargo': _pick_column(columns, *CARGO_FIELD_CANDIDATES),
            'shipper': _pick_column(columns, *SHIPPER_FIELD_CANDIDATES),
            'receiver': _pick_column(columns, *RECEIVER_FIELD_CANDIDATES),
            'carrier': _pick_column(columns, *CARRIER_FIELD_CANDIDATES),
            'trailer': _pick_column(columns, *TRAILER_FIELD_CANDIDATES),
            'gross': _pick_column(columns, *GROSS_FIELD_CANDIDATES),
            'tare': _pick_column(columns, *TARE_FIELD_CANDIDATES),
            'net': _pick_column(columns, *NET_FIELD_CANDIDATES),
            'operator': _pick_column(columns, *OPERATOR_FIELD_CANDIDATES),
            'deleted': _pick_column(columns, *DELETED_FIELD_CANDIDATES),
            'date_brutto': _pick_column(columns, *DATE_BRUTTO_CANDIDATES),
            'time_brutto': _pick_column(columns, *TIME_BRUTTO_CANDIDATES),
            'date_tara': _pick_column(columns, *DATE_TARE_CANDIDATES),
            'time_tara': _pick_column(columns, *TIME_TARE_CANDIDATES),
        }
        if not mapping['vehicle'] or not (mapping['gross'] or mapping['net']):
            raise FileNotFoundError(f'В таблице {table} нет обязательных полей госномера и веса')

        select_cols = [col for col in mapping.values() if col]
        cursor.execute(f"SELECT {', '.join(select_cols)} FROM {table}")
        col_index = {name: idx for idx, name in enumerate(select_cols)}

        def value(row, key: str):
            column = mapping.get(key)
            if not column:
                return None
            return row[col_index[column]]

        target = _parse_target_date(date_str)
        items: list[dict] = []
        for row in cursor.fetchall():
            if mapping['deleted'] and _is_deleted(value(row, 'deleted')):
                continue

            datetime_brutto = _combine_date_time(value(row, 'date_brutto'), value(row, 'time_brutto'))
            datetime_tara = _combine_date_time(value(row, 'date_tara'), value(row, 'time_tara'))
            if not datetime_brutto and datetime_tara:
                datetime_brutto = datetime_tara
            if not _row_matches_date(datetime_brutto, datetime_tara, target):
                continue

            gross = _weight_to_kg(value(row, 'gross'))
            tare = _weight_to_kg(value(row, 'tare'))
            net = _weight_to_kg(value(row, 'net'))
            if gross is None and net is None:
                continue
            if net is None and gross is not None and tare is not None:
                net = max(0, round(gross - tare))

            record_id = value(row, 'id')
            wa_id: str | int | None
            if record_id is None:
                wa_id = None
            else:
                text_id = str(record_id).strip()
                wa_id = text_id or None

            items.append({
                'wa_id': wa_id,
                'datetimebrutto': datetime_brutto,
                'datetimetara': datetime_tara,
                'vehicle_number': _vehicle_number(value(row, 'vehicle'), value(row, 'region')),
                'vehicle_brand': format_vehicle_brand(decode_db_text(value(row, 'brand'))) or '',
                'trailer_number': decode_db_text(value(row, 'trailer')),
                'driver_name': format_person_name(_clean_name(value(row, 'driver')) or '') or DEFAULT_LABEL,
                'cargo_name': _clean_name(value(row, 'cargo')) or DEFAULT_LABEL,
                'shipper_name': _clean_name(value(row, 'shipper')) or DEFAULT_LABEL,
                'receiver_name': _clean_name(value(row, 'receiver')) or DEFAULT_LABEL,
                'carrier_name': _clean_name(value(row, 'carrier')) or DEFAULT_LABEL,
                'gross_weight': gross,
                'tare_weight': tare,
                'net_weight': net,
                'operator_name': _clean_name(value(row, 'operator')) or DEFAULT_LABEL,
            })
        return items
    finally:
        try:
            cursor.close()
        except Exception:
            pass
        _close_connection(conn)


def _is_sqlite_file(path: str) -> bool:
    lower = path.casefold()
    if lower.endswith(('.sqlite', '.sqlite3', '.db')):
        return True
    try:
        with open(path, 'rb') as handle:
            return handle.read(16).startswith(b'SQLite format 3')
    except OSError:
        return False


def _sqlite_tables(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return [str(row[0]) for row in rows if row and row[0]]


def _sqlite_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    rows = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
    return {str(row[1]).upper() for row in rows if len(row) > 1 and row[1]}


def _fetch_sqlite_items(db_path: str, date_str: str) -> list[dict]:
    connection = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    try:
        best_table = None
        best_columns: set[str] = set()
        best_score = 0
        for table in _sqlite_tables(connection):
            columns = _sqlite_columns(connection, table)
            score = 0
            if _pick_column(columns, *VEHICLE_FIELD_CANDIDATES):
                score += 3
            if _pick_column(columns, *GROSS_FIELD_CANDIDATES):
                score += 3
            if _pick_column(columns, *NET_FIELD_CANDIDATES):
                score += 2
            if _pick_column(columns, *DATE_BRUTTO_CANDIDATES):
                score += 2
            if score > best_score:
                best_score = score
                best_table = table
                best_columns = columns
        if not best_table or best_score < 6:
            raise FileNotFoundError('В SQLite-базе WA не найдена таблица журнала взвешиваний')

        mapping = {
            'id': _pick_column(best_columns, *ID_FIELD_CANDIDATES),
            'vehicle': _pick_column(best_columns, *VEHICLE_FIELD_CANDIDATES),
            'region': _pick_column(best_columns, *REGION_FIELD_CANDIDATES),
            'brand': _pick_column(best_columns, *BRAND_FIELD_CANDIDATES),
            'driver': _pick_column(best_columns, *DRIVER_FIELD_CANDIDATES),
            'cargo': _pick_column(best_columns, *CARGO_FIELD_CANDIDATES),
            'shipper': _pick_column(best_columns, *SHIPPER_FIELD_CANDIDATES),
            'receiver': _pick_column(best_columns, *RECEIVER_FIELD_CANDIDATES),
            'carrier': _pick_column(best_columns, *CARRIER_FIELD_CANDIDATES),
            'trailer': _pick_column(best_columns, *TRAILER_FIELD_CANDIDATES),
            'gross': _pick_column(best_columns, *GROSS_FIELD_CANDIDATES),
            'tare': _pick_column(best_columns, *TARE_FIELD_CANDIDATES),
            'net': _pick_column(best_columns, *NET_FIELD_CANDIDATES),
            'operator': _pick_column(best_columns, *OPERATOR_FIELD_CANDIDATES),
            'deleted': _pick_column(best_columns, *DELETED_FIELD_CANDIDATES),
            'date_brutto': _pick_column(best_columns, *DATE_BRUTTO_CANDIDATES),
            'time_brutto': _pick_column(best_columns, *TIME_BRUTTO_CANDIDATES),
            'date_tara': _pick_column(best_columns, *DATE_TARE_CANDIDATES),
            'time_tara': _pick_column(best_columns, *TIME_TARE_CANDIDATES),
        }
        select_cols = [col for col in mapping.values() if col]
        rows = connection.execute(
            f'SELECT {", ".join(select_cols)} FROM "{best_table}"'
        ).fetchall()
        col_index = {name: idx for idx, name in enumerate(select_cols)}
        target = _parse_target_date(date_str)
        items: list[dict] = []

        def value(row, key: str):
            column = mapping.get(key)
            if not column:
                return None
            return row[col_index[column]]

        for row in rows:
            if mapping['deleted'] and _is_deleted(value(row, 'deleted')):
                continue
            datetime_brutto = _combine_date_time(value(row, 'date_brutto'), value(row, 'time_brutto'))
            datetime_tara = _combine_date_time(value(row, 'date_tara'), value(row, 'time_tara'))
            if not datetime_brutto and datetime_tara:
                datetime_brutto = datetime_tara
            if not _row_matches_date(datetime_brutto, datetime_tara, target):
                continue
            gross = _weight_to_kg(value(row, 'gross'))
            tare = _weight_to_kg(value(row, 'tare'))
            net = _weight_to_kg(value(row, 'net'))
            if gross is None and net is None:
                continue
            if net is None and gross is not None and tare is not None:
                net = max(0, round(gross - tare))
            record_id = value(row, 'id')
            items.append({
                'wa_id': str(record_id).strip() if record_id is not None else None,
                'datetimebrutto': datetime_brutto,
                'datetimetara': datetime_tara,
                'vehicle_number': _vehicle_number(value(row, 'vehicle'), value(row, 'region')),
                'vehicle_brand': format_vehicle_brand(decode_db_text(value(row, 'brand'))) or '',
                'trailer_number': decode_db_text(value(row, 'trailer')),
                'driver_name': format_person_name(_clean_name(value(row, 'driver')) or '') or DEFAULT_LABEL,
                'cargo_name': _clean_name(value(row, 'cargo')) or DEFAULT_LABEL,
                'shipper_name': _clean_name(value(row, 'shipper')) or DEFAULT_LABEL,
                'receiver_name': _clean_name(value(row, 'receiver')) or DEFAULT_LABEL,
                'carrier_name': _clean_name(value(row, 'carrier')) or DEFAULT_LABEL,
                'gross_weight': gross,
                'tare_weight': tare,
                'net_weight': net,
                'operator_name': _clean_name(value(row, 'operator')) or DEFAULT_LABEL,
            })
        return items
    finally:
        connection.close()


def test_wa_connection(db_path: str, user: str = DEFAULT_USER, password: str = DEFAULT_PASSWORD) -> int:
    resolved = resolve_wa_db_path(db_path)
    if not resolved:
        raise ValueError('Не указан путь к базе WA')
    if not os.path.exists(resolved):
        raise FileNotFoundError(f'Файл базы не найден: {resolved}')

    if _is_sqlite_file(resolved):
        connection = sqlite3.connect(f'file:{resolved}?mode=ro', uri=True)
        try:
            tables = _sqlite_tables(connection)
            if not tables:
                return 0
            table = tables[0]
            row = connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()
            return int(row[0] if row else 0)
        finally:
            connection.close()

    if fdb is None:
        raise RuntimeError('Модуль fdb не установлен. Используйте Python 3.11/3.12: pip install -r server/requirements.txt')

    conn = connect_wa_with_timeout(resolved, user, password)
    cursor = conn.cursor()
    try:
        table, _columns = _find_weighing_table(cursor)
        cursor.execute(f'SELECT COUNT(*) FROM {table}')
        row = cursor.fetchone()
        return int(row[0] if row else 0)
    finally:
        try:
            cursor.close()
        except Exception:
            pass
        _close_connection(conn)


def fetch_wa_items(
    db_path: str,
    date_str: str,
    user: str = DEFAULT_USER,
    password: str = DEFAULT_PASSWORD,
) -> list[dict]:
    resolved = resolve_wa_db_path(db_path)
    if not resolved:
        raise ValueError('Не указан путь к базе WA')
    if not os.path.exists(resolved):
        raise FileNotFoundError(f'Файл базы не найден: {resolved}')

    if _is_sqlite_file(resolved):
        return _fetch_sqlite_items(resolved, date_str)
    return _fetch_firebird_items(resolved, date_str, user, password)


def fetch_wa_dictionary_names(
    db_path: str,
    user: str = DEFAULT_USER,
    password: str = DEFAULT_PASSWORD,
) -> dict[str, list[Any]]:
    resolved = resolve_wa_db_path(db_path)
    # Pull a wide date range by scanning without date filter via helper reuse:
    # Use epoch-wide fetch by calling internal fetchers with today's date is insufficient.
    # Instead, read distinct values from discovered columns.
    cargos: set[str] = set()
    shippers: set[str] = set()
    receivers: set[str] = set()
    carriers: set[str] = set()
    drivers: set[str] = set()
    vehicles: set[str] = set()

    if _is_sqlite_file(resolved):
        connection = sqlite3.connect(f'file:{resolved}?mode=ro', uri=True)
        try:
            for table in _sqlite_tables(connection):
                columns = _sqlite_columns(connection, table)
                field_map = {
                    'cargo': _pick_column(columns, *CARGO_FIELD_CANDIDATES),
                    'shipper': _pick_column(columns, *SHIPPER_FIELD_CANDIDATES),
                    'receiver': _pick_column(columns, *RECEIVER_FIELD_CANDIDATES),
                    'carrier': _pick_column(columns, *CARRIER_FIELD_CANDIDATES),
                    'driver': _pick_column(columns, *DRIVER_FIELD_CANDIDATES),
                    'vehicle': _pick_column(columns, *VEHICLE_FIELD_CANDIDATES),
                    'region': _pick_column(columns, *REGION_FIELD_CANDIDATES),
                }
                selected = [col for col in field_map.values() if col]
                if not selected:
                    continue
                rows = connection.execute(
                    f'SELECT {", ".join(selected)} FROM "{table}"'
                ).fetchall()
                index = {name: idx for idx, name in enumerate(selected)}

                def get(row, key):
                    column = field_map.get(key)
                    if not column:
                        return None
                    return row[index[column]]

                for row in rows:
                    for bucket, key in (
                        (cargos, 'cargo'),
                        (shippers, 'shipper'),
                        (receivers, 'receiver'),
                        (carriers, 'carrier'),
                    ):
                        cleaned = _clean_name(get(row, key))
                        if cleaned:
                            bucket.add(cleaned)
                    for part in split_person_names(get(row, 'driver') or ''):
                        cleaned = _clean_name(part)
                        if cleaned:
                            drivers.add(cleaned)
                    plate = _vehicle_number(get(row, 'vehicle'), get(row, 'region'))
                    if plate and plate != DEFAULT_LABEL and is_readable_vehicle_number(plate):
                        vehicles.add(plate)
        finally:
            connection.close()
    else:
        if fdb is None:
            raise RuntimeError('Модуль fdb не установлен. Используйте Python 3.11/3.12: pip install -r server/requirements.txt')
        conn = connect_wa_with_timeout(resolved, user, password)
        cursor = conn.cursor()
        try:
            table, columns = _find_weighing_table(cursor)
            field_map = {
                'cargo': _pick_column(columns, *CARGO_FIELD_CANDIDATES),
                'shipper': _pick_column(columns, *SHIPPER_FIELD_CANDIDATES),
                'receiver': _pick_column(columns, *RECEIVER_FIELD_CANDIDATES),
                'carrier': _pick_column(columns, *CARRIER_FIELD_CANDIDATES),
                'driver': _pick_column(columns, *DRIVER_FIELD_CANDIDATES),
                'vehicle': _pick_column(columns, *VEHICLE_FIELD_CANDIDATES),
                'region': _pick_column(columns, *REGION_FIELD_CANDIDATES),
            }
            selected = [col for col in field_map.values() if col]
            if selected:
                cursor.execute(f"SELECT {', '.join(selected)} FROM {table}")
                index = {name: idx for idx, name in enumerate(selected)}

                def get(row, key):
                    column = field_map.get(key)
                    if not column:
                        return None
                    return row[index[column]]

                for row in cursor.fetchall():
                    for bucket, key in (
                        (cargos, 'cargo'),
                        (shippers, 'shipper'),
                        (receivers, 'receiver'),
                        (carriers, 'carrier'),
                    ):
                        cleaned = _clean_name(get(row, key))
                        if cleaned:
                            bucket.add(cleaned)
                    for part in split_person_names(get(row, 'driver') or ''):
                        cleaned = _clean_name(part)
                        if cleaned:
                            drivers.add(cleaned)
                    plate = _vehicle_number(get(row, 'vehicle'), get(row, 'region'))
                    if plate and plate != DEFAULT_LABEL and is_readable_vehicle_number(plate):
                        vehicles.add(plate)
        finally:
            try:
                cursor.close()
            except Exception:
                pass
            _close_connection(conn)

    return {
        'cargos': sorted(cargos, key=str.casefold),
        'shippers': sorted(shippers, key=str.casefold),
        'receivers': sorted(receivers, key=str.casefold),
        'carriers': sorted(carriers, key=str.casefold),
        'vehicles': sorted(vehicles, key=str.casefold),
        'drivers': sorted(drivers, key=str.casefold),
    }
