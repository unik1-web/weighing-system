try:
    import fdb
except ImportError:  # pragma: no cover
    fdb = None

import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

from dictionary_import import _dedupe_vehicle_records
from text_encoding import (
    decode_db_text,
    format_person_name,
    format_vehicle_brand,
    format_vehicle_plate,
    is_readable_name,
    is_readable_vehicle_number,
    split_person_names,
)

FIREBIRD_CHARSET = 'WIN1251'
DEFAULT_LABELS = {'—', '-', ''}


def connect_vescom(db_path: str, user: str, password: str):
    if fdb is None:
        raise RuntimeError(
            'Модуль fdb не установлен. Используйте Python 3.11/3.12: pip install -r server/requirements.txt'
        )
    return fdb.connect(
        dsn=db_path.strip().replace('\\', '/'),
        user=user,
        password=password,
        charset=FIREBIRD_CHARSET,
    )


def connect_vescom_with_timeout(db_path: str, user: str, password: str, timeout_seconds: float = 8.0):
    """Connect with a real timeout.

    ThreadPoolExecutor's context manager calls shutdown(wait=True), which would
    block until a hung fdb.connect() finishes — defeating the timeout. Keep the
    executor alive without waiting so the caller unblocks after timeout_seconds.
    """
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(connect_vescom, db_path, user, password)
    try:
        return future.result(timeout=timeout_seconds)
    except FutureTimeoutError as exc:
        future.cancel()
        raise TimeoutError(f'Таймаут подключения к базе Vescom: {db_path}') from exc
    finally:
        try:
            executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:  # pragma: no cover - Python < 3.9
            executor.shutdown(wait=False)


def _close_connection(conn) -> None:
    try:
        conn.commit()
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass


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


def _clean_name(value) -> str:
    text = decode_db_text(value)
    if not text or text in DEFAULT_LABELS:
        return ''
    if not is_readable_name(text):
        return ''
    return text


def _collect_names(cursor, query: str) -> set[str]:
    names: set[str] = set()
    try:
        cursor.execute(query)
        for row in cursor.fetchall():
            name = _clean_name(row[0])
            if name:
                names.add(name)
    except Exception:
        pass
    return names


def _collect_person_names(cursor, query: str) -> set[str]:
    names: set[str] = set()
    try:
        cursor.execute(query)
        for row in cursor.fetchall():
            for name in split_person_names(row[0]):
                cleaned = _clean_name(name)
                if cleaned:
                    names.add(cleaned)
    except Exception:
        pass
    return names


def _tara_to_kg(value) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    if number < 100:
        number *= 1000
    return round(number)


def _collect_vehicle_records(cursor, query: str) -> list[dict]:
    records: list[dict] = []
    try:
        cursor.execute(query)
        for row in cursor.fetchall():
            number = format_vehicle_plate(row[0])
            if not number or not is_readable_vehicle_number(number):
                continue
            brand = decode_db_text(row[1]).strip() if len(row) > 1 and row[1] else ''
            tare_kg = _tara_to_kg(row[2]) if len(row) > 2 else None
            records.append({
                'number': number,
                'brand': brand,
                'tare_kg': tare_kg,
            })
    except Exception:
        pass
    return records


def _collect_vehicle_numbers(cursor, query: str) -> list[dict]:
    records: list[dict] = []
    try:
        cursor.execute(query)
        for row in cursor.fetchall():
            number = format_vehicle_plate(row[0])
            if not number or not is_readable_vehicle_number(number):
                continue
            records.append({'number': number, 'brand': '', 'tare_kg': None})
    except Exception:
        pass
    return records


def _fetch_cars_vehicles(db_path: str, user: str, password: str, active_row: str) -> list[dict]:
    records: list[dict] = []
    query = f"""
        SELECT TRIM(CAR_NUMBER), TRIM(CAR_MARKA), DEFAULT_TARA
        FROM CARS
        WHERE CAR_NUMBER IS NOT NULL
          AND TRIM(CAR_NUMBER) <> ''
          AND {active_row}
    """

    for candidate in _related_vescom_db_paths(db_path):
        conn = None
        cursor = None
        try:
            conn = connect_vescom(candidate, user, password)
            cursor = conn.cursor()
            if not _table_exists(cursor, 'CARS'):
                continue
            records.extend(_collect_vehicle_records(cursor, query))
        except Exception:
            continue
        finally:
            if cursor is not None:
                try:
                    cursor.close()
                except Exception:
                    pass
            if conn is not None:
                _close_connection(conn)

    return records


def _fetch_vehicles(db_path: str, user: str, password: str, active_row: str) -> list[dict]:
    records: list[dict] = []

    conn = None
    cursor = None
    try:
        conn = connect_vescom(db_path, user, password)
        cursor = conn.cursor()

        if _table_exists(cursor, 'WEIGHINGS'):
            records.extend(
                _collect_vehicle_records(
                    cursor,
                    f"""
                    SELECT TRIM(CAR_NUMBER), TRIM(CAR_MARKA), NULL
                    FROM WEIGHINGS
                    WHERE CAR_NUMBER IS NOT NULL
                      AND TRIM(CAR_NUMBER) <> ''
                      AND {active_row}
                    """,
                ),
            )

        if _table_exists(cursor, 'EVENTS'):
            records.extend(
                _collect_vehicle_numbers(
                    cursor,
                    """
                    SELECT DISTINCT TRIM(NOMER_TS || REGION_TS)
                    FROM EVENTS
                    WHERE NOMER_TS IS NOT NULL AND TRIM(NOMER_TS) <> ''
                    """,
                ),
            )

        if _table_exists(cursor, 'TRANSPORT'):
            records.extend(
                _collect_vehicle_numbers(
                    cursor,
                    "SELECT NOMER FROM TRANSPORT WHERE NOMER IS NOT NULL AND TRIM(NOMER) <> ''",
                ),
            )
    except Exception:
        pass
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
        if conn is not None:
            _close_connection(conn)

    records.extend(_fetch_cars_vehicles(db_path, user, password, active_row))
    return records


def _collect_from_queries(cursor, queries: list[str]) -> set[str]:
    names: set[str] = set()
    for query in queries:
        names.update(_collect_names(cursor, query))
    return names


def _collect_persons_from_queries(cursor, queries: list[str]) -> set[str]:
    names: set[str] = set()
    for query in queries:
        names.update(_collect_person_names(cursor, query))
    return names


def _queries_for_table(cursor, table_name: str, queries: list[str]) -> list[str]:
    if _table_exists(cursor, table_name):
        return queries
    return []


def _vescom_install_root(db_path: str) -> str:
    cleaned = os.path.abspath(db_path.strip())
    parts = cleaned.split(os.sep)
    for index, part in enumerate(parts):
        if part.casefold() == 'vescom':
            return os.sep.join(parts[: index + 1])

    directory = os.path.dirname(cleaned)
    parent = os.path.dirname(directory)
    grandparent = os.path.dirname(parent)
    if os.path.basename(grandparent).casefold() == 'vescom':
        return grandparent
    if os.path.basename(parent).casefold() == 'vescom':
        return parent
    return grandparent or parent or directory


def _related_vescom_db_paths(db_path: str) -> list[str]:
    cleaned = os.path.abspath(db_path.strip())
    paths: list[str] = []
    seen: set[str] = set()

    def add(path: str) -> None:
        normalized = os.path.abspath(path)
        key = normalized.casefold()
        if key in seen or not os.path.isfile(normalized):
            return
        seen.add(key)
        paths.append(normalized)

    add(cleaned)

    directory = os.path.dirname(cleaned)
    parent = os.path.dirname(directory)
    grandparent = os.path.dirname(parent)
    for folder in {directory, parent, grandparent, os.path.join(parent, 'Database')}:
        add(os.path.join(folder, 'STATICTRUCKSCALE.FDB'))

    vescom_root = _vescom_install_root(cleaned)
    for scale_dir in ('StaticTruckScale', 'StaticTruckScale1', 'Vescom'):
        add(os.path.join(vescom_root, scale_dir, 'Database', 'STATICTRUCKSCALE.FDB'))
        add(os.path.join(vescom_root, scale_dir, 'STATICTRUCKSCALE.FDB'))

    add(os.path.join(vescom_root, 'STATICTRUCKSCALE.FDB'))
    return paths


def _fetch_cars_drivers(db_path: str, user: str, password: str, active_row: str) -> set[str]:
    names: set[str] = set()
    query = f"""
        SELECT TRIM(DRIVER)
        FROM CARS
        WHERE DRIVER IS NOT NULL
          AND TRIM(DRIVER) <> ''
          AND {active_row}
    """

    for candidate in _related_vescom_db_paths(db_path):
        conn = None
        cursor = None
        try:
            conn = connect_vescom(candidate, user, password)
            cursor = conn.cursor()
            if not _table_exists(cursor, 'CARS'):
                continue
            names.update(_collect_person_names(cursor, query))
        except Exception:
            continue
        finally:
            if cursor is not None:
                try:
                    cursor.close()
                except Exception:
                    pass
            if conn is not None:
                _close_connection(conn)

    return names


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


def _pick_column(columns: set[str], *names: str) -> str | None:
    for name in names:
        if name.upper() in columns:
            return name.upper()
    return None


def _datetime_expression(columns: set[str], *date_names: str, time_names: tuple[str, ...] = ()) -> str | None:
    date_col = _pick_column(columns, *date_names)
    if not date_col:
        return None
    if date_col.endswith('_DT'):
        return date_col
    time_col = _pick_column(columns, *time_names) if time_names else None
    if time_col:
        return f'{date_col} + {time_col}'
    return date_col


def _build_weighing_date_filter(columns: set[str]) -> str | None:
    parts: list[str] = []
    for date_names in (('BRUTTO_DT', 'DATE_BRUTTO'), ('TARA_DT', 'DATE_TARA')):
        date_col = _pick_column(columns, *date_names)
        if date_col:
            parts.append(f'CAST({date_col} AS DATE) = ?')
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return '(' + ' OR '.join(parts) + ')'


def _parse_weighing_target_date(date_str: str):
    from datetime import datetime

    target = datetime.strptime(date_str, '%Y-%m-%d').date()
    return target


def _weight_to_kg(value) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
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
    return str(value).strip()


def _sql_trim(column: str | None) -> str:
    return f'TRIM({column})' if column else "''"


def _fetch_weighings_from_weighings(cursor, date_str: str, active_row: str) -> list[dict]:
    columns = _table_columns(cursor, 'WEIGHINGS')
    if not columns or not _pick_column(columns, 'CAR_NUMBER'):
        return []

    dt_brutto = _datetime_expression(
        columns,
        'BRUTTO_DT',
        'DATE_BRUTTO',
        time_names=('TIME_BRUTTO',),
    )
    dt_tara = _datetime_expression(
        columns,
        'TARA_DT',
        'DATE_TARA',
        time_names=('TIME_TARA',),
    )
    if not dt_brutto:
        return []

    date_filter = _build_weighing_date_filter(columns)
    if not date_filter:
        return []

    car_number = _sql_trim(_pick_column(columns, 'CAR_NUMBER'))
    car_marka = _sql_trim(_pick_column(columns, 'CAR_MARKA', 'CAR_MARK'))
    receiver = _sql_trim(_pick_column(columns, 'RECEIVER'))
    sender = _sql_trim(_pick_column(columns, 'SENDER'))
    carrier = _sql_trim(_pick_column(columns, 'CARRIER'))
    driver = _sql_trim(_pick_column(columns, 'DRIVER'))
    cargo = _sql_trim(_pick_column(columns, 'PRODUCT', 'CARGO'))
    brutto = _pick_column(columns, 'BRUTTO', 'GROSS') or 'NULL'
    tara = _pick_column(columns, 'TARA') or 'NULL'
    netto = _pick_column(columns, 'NETTO') or 'NULL'
    record_id = _pick_column(columns, 'ID', 'WEIGHING_ID') or 'NULL'

    filters = [date_filter]
    if _pick_column(columns, 'DELETED'):
        filters.append(f'({active_row})')

    target_date = _parse_weighing_target_date(date_str)
    params = [target_date]
    if date_filter.count('?') == 2:
        params.append(target_date)

    query = f"""
        SELECT {record_id},
               {dt_brutto},
               {dt_tara or 'NULL'},
               {car_number},
               {car_marka},
               {receiver},
               {brutto},
               {tara},
               {netto},
               {cargo},
               {sender},
               {carrier},
               {driver}
        FROM WEIGHINGS
        WHERE {' AND '.join(filters)}
    """

    cursor.execute(query, tuple(params))
    items: list[dict] = []
    for row in cursor.fetchall():
        gross = _weight_to_kg(row[6])
        if gross is None:
            continue
        tare = _weight_to_kg(row[7])
        net = _weight_to_kg(row[8])
        if net is None and tare is not None:
            net = max(0, round(gross - tare))

        record_id_value = row[0]
        items.append({
            'vescom_id': int(record_id_value) if record_id_value is not None else None,
            'datetimebrutto': _format_datetime(row[1]),
            'datetimetara': _format_datetime(row[2]),
            'vehicle_number': format_vehicle_plate(decode_db_text(row[3])),
            'vehicle_brand': format_vehicle_brand(decode_db_text(row[4])),
            'receiver_name': _clean_name(row[5]) or '—',
            'gross_weight': gross,
            'tare_weight': tare,
            'net_weight': net,
            'cargo_name': _clean_name(row[9]) or '—',
            'shipper_name': _clean_name(row[10]) or '—',
            'carrier_name': _clean_name(row[11]) or '—',
            'driver_name': format_person_name(_clean_name(row[12]) or '') or '—',
        })
    return items


def _fetch_weighings_from_events(cursor, date_str: str) -> list[dict]:
    if not _table_exists(cursor, 'EVENTS'):
        return []

    query = """
        SELECT DATE_BRUTTO + TIME_BRUTTO,
               DATE_TARA + TIME_TARA,
               NOMER_TS || REGION_TS,
               MARKA_TS,
               FIRMA_POL,
               BRUTTO,
               TARA,
               NETTO,
               GRUZ_NAME
        FROM EVENTS
        WHERE DATE_TARA IS NOT NULL
          AND DATE_BRUTTO = ?
          AND ENABLE = 0
    """
    cursor.execute(query, (date_str,))
    items: list[dict] = []
    for row in cursor.fetchall():
        gross = _weight_to_kg(row[5])
        if gross is None:
            continue
        tare = _weight_to_kg(row[6])
        net = _weight_to_kg(row[7])
        if net is None and tare is not None:
            net = max(0, round(gross - tare))

        items.append({
            'vescom_id': None,
            'datetimebrutto': _format_datetime(row[0]),
            'datetimetara': _format_datetime(row[1]),
            'vehicle_number': format_vehicle_plate(decode_db_text(row[2])),
            'vehicle_brand': format_vehicle_brand(decode_db_text(row[3])),
            'receiver_name': _clean_name(row[4]) or '—',
            'gross_weight': gross,
            'tare_weight': tare,
            'net_weight': net,
            'cargo_name': _clean_name(row[8]) or '—',
            'shipper_name': '—',
            'carrier_name': '—',
            'driver_name': '—',
        })
    return items


def fetch_vescom_weighings(db_path: str, date_str: str, user: str, password: str) -> list[dict]:
    active_row = '(DELETED = 0 OR DELETED IS NULL)'
    last_error: Exception | None = None
    merged: list[dict] = []
    seen_keys: set[str] = set()
    tables_found = False
    opened_any = False

    primary_path = os.path.abspath(db_path.strip())
    candidate_paths = _related_vescom_db_paths(db_path)
    ordered_paths = [primary_path] + [path for path in candidate_paths if path.casefold() != primary_path.casefold()]

    for candidate in ordered_paths:
        conn = None
        cursor = None
        try:
            conn = connect_vescom_with_timeout(candidate, user, password)
            cursor = conn.cursor()
            opened_any = True

            has_weighings = _table_exists(cursor, 'WEIGHINGS')
            has_events = _table_exists(cursor, 'EVENTS')
            if has_weighings or has_events:
                tables_found = True

            items = _fetch_weighings_from_weighings(cursor, date_str, active_row)
            if not items and has_events:
                items = _fetch_weighings_from_events(cursor, date_str)

            for item in items:
                dedupe_key = '|'.join(
                    [
                        str(item.get('vescom_id') or ''),
                        item.get('datetimebrutto') or '',
                        item.get('vehicle_number') or '',
                        str(item.get('gross_weight') or ''),
                    ],
                )
                if dedupe_key in seen_keys:
                    continue
                seen_keys.add(dedupe_key)
                merged.append(item)
        except Exception as exc:
            last_error = exc
            continue
        finally:
            if cursor is not None:
                try:
                    cursor.close()
                except Exception:
                    pass
            if conn is not None:
                _close_connection(conn)

    if merged or tables_found:
        return merged

    if last_error is not None:
        raise last_error
    if not opened_any:
        raise FileNotFoundError(f'Файл базы Vescom не найден: {db_path}')
    raise FileNotFoundError('В базе Vescom не найдены таблицы WEIGHINGS или EVENTS')


def fetch_vescom_dictionaries(db_path: str, user: str, password: str) -> dict[str, list[str]]:
    conn = connect_vescom(db_path, user, password)
    cursor = conn.cursor()

    active_client = '(DELETED = 0 OR DELETED IS NULL)'
    active_row = '(DELETED = 0 OR DELETED IS NULL)'

    try:
        vehicles = _dedupe_vehicle_records(_fetch_vehicles(db_path, user, password, active_row))

        driver_queries: list[str] = []
        driver_queries.extend(
            _queries_for_table(
                cursor,
                'WEIGHINGS',
                [
                    """
                    SELECT DISTINCT TRIM(DRIVER)
                    FROM WEIGHINGS
                    WHERE DRIVER IS NOT NULL AND TRIM(DRIVER) <> ''
                    """,
                ],
            ),
        )
        driver_queries.extend(
            _queries_for_table(
                cursor,
                'EVENTS',
                [
                    """
                    SELECT DISTINCT TRIM(DRIVER)
                    FROM EVENTS
                    WHERE DRIVER IS NOT NULL AND TRIM(DRIVER) <> ''
                    """,
                ],
            ),
        )
        drivers = _collect_persons_from_queries(cursor, driver_queries)
        drivers.update(_fetch_cars_drivers(db_path, user, password, active_row))

        cargo_queries: list[str] = []
        cargo_queries.extend(
            _queries_for_table(
                cursor,
                'PRODUCTS',
                [f'SELECT NAME FROM PRODUCTS WHERE NAME IS NOT NULL AND {active_row}'],
            ),
        )
        cargo_queries.extend(
            _queries_for_table(
                cursor,
                'WEIGHINGS',
                [f'SELECT DISTINCT PRODUCT FROM WEIGHINGS WHERE PRODUCT IS NOT NULL AND {active_row}'],
            ),
        )
        cargo_queries.extend(
            _queries_for_table(cursor, 'GRUZ', ['SELECT GRUZ_NAME FROM GRUZ WHERE GRUZ_NAME IS NOT NULL']),
        )
        cargo_queries.extend(
            _queries_for_table(
                cursor,
                'EVENTS',
                ['SELECT DISTINCT GRUZ_NAME FROM EVENTS WHERE GRUZ_NAME IS NOT NULL'],
            ),
        )
        cargos = _collect_from_queries(cursor, cargo_queries)

        receiver_queries: list[str] = []
        receiver_queries.extend(
            _queries_for_table(
                cursor,
                'CLIENTS',
                [f'SELECT NAME FROM CLIENTS WHERE NAME IS NOT NULL AND {active_client} AND IS_RECEIVER = 1'],
            ),
        )
        receiver_queries.extend(
            _queries_for_table(
                cursor,
                'WEIGHINGS',
                [f'SELECT DISTINCT RECEIVER FROM WEIGHINGS WHERE RECEIVER IS NOT NULL AND {active_row}'],
            ),
        )
        receiver_queries.extend(
            _queries_for_table(cursor, 'FIRMS', ['SELECT NAME FROM FIRMS WHERE NAME IS NOT NULL']),
        )
        receiver_queries.extend(
            _queries_for_table(
                cursor,
                'EVENTS',
                ['SELECT DISTINCT FIRMA_POL FROM EVENTS WHERE FIRMA_POL IS NOT NULL'],
            ),
        )
        receivers = _collect_from_queries(cursor, receiver_queries)

        shipper_queries: list[str] = []
        shipper_queries.extend(
            _queries_for_table(
                cursor,
                'CLIENTS',
                [f'SELECT NAME FROM CLIENTS WHERE NAME IS NOT NULL AND {active_client} AND IS_SENDER = 1'],
            ),
        )
        shipper_queries.extend(
            _queries_for_table(
                cursor,
                'WEIGHINGS',
                [f'SELECT DISTINCT SENDER FROM WEIGHINGS WHERE SENDER IS NOT NULL AND {active_row}'],
            ),
        )
        shipper_queries.extend(
            _queries_for_table(cursor, 'FIRMS', ['SELECT NAME FROM FIRMS WHERE NAME IS NOT NULL']),
        )
        shippers = _collect_from_queries(cursor, shipper_queries)

        carrier_queries: list[str] = []
        carrier_queries.extend(
            _queries_for_table(
                cursor,
                'CLIENTS',
                [f'SELECT NAME FROM CLIENTS WHERE NAME IS NOT NULL AND {active_client} AND IS_CARRIER = 1'],
            ),
        )
        carrier_queries.extend(
            _queries_for_table(
                cursor,
                'WEIGHINGS',
                [f'SELECT DISTINCT CARRIER FROM WEIGHINGS WHERE CARRIER IS NOT NULL AND {active_row}'],
            ),
        )
        carrier_queries.extend(
            _queries_for_table(cursor, 'FIRMS', ['SELECT NAME FROM FIRMS WHERE NAME IS NOT NULL']),
        )
        carriers = _collect_from_queries(cursor, carrier_queries)

        return {
            'cargos': sorted(cargos, key=str.casefold),
            'receivers': sorted(receivers, key=str.casefold),
            'shippers': sorted(shippers, key=str.casefold),
            'carriers': sorted(carriers, key=str.casefold),
            'vehicles': sorted(vehicles, key=lambda item: str(item.get('number', '')).casefold()),
            'drivers': sorted(drivers, key=str.casefold),
        }
    finally:
        try:
            cursor.close()
        except Exception:
            pass
        _close_connection(conn)
