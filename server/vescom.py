try:
    import fdb
except ImportError:  # pragma: no cover
    fdb = None

import os

from dictionary_import import _dedupe_vehicle_records
from text_encoding import (
    decode_db_text,
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
