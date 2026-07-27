import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlite_store import connect, init_schema
from text_encoding import (
    decode_db_text,
    format_person_name,
    format_vehicle_brand,
    format_vehicle_plate,
    is_readable_name,
    is_readable_vehicle_number,
    normalize_vehicle_key,
    split_person_names,
)

DEFAULT_LABELS = {'—', '-', ''}

CATEGORY_LABELS = {
    'drivers': 'водителей',
    'cargos': 'грузов',
    'vehicles': 'автомобилей',
    'receivers': 'получателей',
    'shippers': 'отправителей',
    'carriers': 'перевозчиков',
}


def _normalize_name(value: str) -> str:
    return ' '.join(str(value or '').strip().split())


def _entry_key(category: str, name: str) -> str:
    if category == 'vehicles':
        return normalize_vehicle_key(name)
    return name.casefold()


def _clean_names(values: list[str], *, split_people: bool = False, category: str = '') -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in values:
        parts = split_person_names(raw) if split_people else [decode_db_text(raw)]
        for part in parts:
            if category == 'vehicles':
                name = format_vehicle_plate(part)
            elif category == 'drivers':
                name = format_person_name(part)
            else:
                name = _normalize_name(part)
            if not name or name in DEFAULT_LABELS:
                continue
            if category == 'vehicles':
                if not is_readable_vehicle_number(name):
                    continue
            elif not is_readable_name(name):
                continue
            key = _entry_key(category, name)
            if key in seen:
                continue
            seen.add(key)
            result.append(name)
    return sorted(result, key=lambda item: item.casefold())


def _vehicle_record_score(record: dict[str, Any]) -> int:
    score = 0
    if record.get('brand'):
        score += 4
    if record.get('tare_kg') is not None:
        score += 2
    return score


def _normalize_vehicle_record(raw: dict[str, Any]) -> dict[str, Any] | None:
    number = format_vehicle_plate(str(raw.get('number') or ''))
    if not number or not is_readable_vehicle_number(number):
        return None

    brand = format_vehicle_brand(raw.get('brand') or '')
    if brand and not is_readable_name(brand):
        brand = ''

    tare_kg = raw.get('tare_kg')
    if tare_kg is not None:
        try:
            tare_kg = round(float(tare_kg))
            if tare_kg <= 0:
                tare_kg = None
        except (TypeError, ValueError):
            tare_kg = None

    return {
        'number': number,
        'brand': brand,
        'tare_kg': tare_kg,
    }


def _dedupe_vehicle_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for raw in records:
        record = _normalize_vehicle_record(raw)
        if not record:
            continue
        key = normalize_vehicle_key(record['number'])
        current = merged.get(key)
        if current is None or _vehicle_record_score(record) > _vehicle_record_score(current):
            merged[key] = record
    return sorted(merged.values(), key=lambda item: item['number'].casefold())


def _load_existing_vehicle_keys(connection) -> dict[str, dict[str, Any]]:
    rows = connection.execute(
        '''
        SELECT id, name, payload
        FROM dictionary_entries
        WHERE category = ?
        ''',
        ('vehicles',),
    ).fetchall()

    existing: dict[str, dict[str, Any]] = {}
    for row in rows:
        try:
            payload = json.loads(row['payload'] or '{}')
        except json.JSONDecodeError:
            payload = {}
        number = str(payload.get('vehicle_number') or row['name'] or '')
        key = normalize_vehicle_key(number)
        if not key:
            continue
        existing[key] = {
            'id': row['id'],
            'name': str(row['name']),
            'brand': str(payload.get('vehicle_brand') or ''),
            'tare_kg': payload.get('default_tare_weight'),
        }
    return existing


def merge_vehicle_records(records: list[dict[str, Any]]) -> int:
    cleaned = _dedupe_vehicle_records(records)
    if not cleaned:
        return 0

    changed = 0
    with connect() as connection:
        init_schema(connection)
        existing = _load_existing_vehicle_keys(connection)
        now = datetime.now(timezone.utc).isoformat()

        for record in cleaned:
            key = normalize_vehicle_key(record['number'])
            payload = {
                'vehicle_number': record['number'],
                'vehicle_brand': record.get('brand') or '',
                'default_tare_weight': record.get('tare_kg'),
            }

            current = existing.get(key)
            if current:
                updates: dict[str, Any] = {}
                if payload['vehicle_brand'] and not current['brand']:
                    updates['vehicle_brand'] = payload['vehicle_brand']
                if payload['default_tare_weight'] is not None and current['tare_kg'] is None:
                    updates['default_tare_weight'] = payload['default_tare_weight']
                if not updates:
                    continue

                merged_payload = {
                    'vehicle_number': current['name'] or record['number'],
                    'vehicle_brand': updates.get('vehicle_brand', current['brand']),
                    'default_tare_weight': updates.get('default_tare_weight', current['tare_kg']),
                }
                connection.execute(
                    '''
                    UPDATE dictionary_entries
                    SET payload = ?
                    WHERE id = ?
                    ''',
                    (json.dumps(merged_payload, ensure_ascii=False), current['id']),
                )
                changed += 1
                continue

            connection.execute(
                '''
                INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
                VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (
                    str(uuid4()),
                    'vehicles',
                    record['number'],
                    f'Импорт {now[:10]}',
                    now,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            existing[key] = {
                'id': '',
                'name': record['number'],
                'brand': payload['vehicle_brand'],
                'tare_kg': payload['default_tare_weight'],
            }
            changed += 1

    return changed


def merge_dictionary_names(category: str, names: list[str]) -> int:
    cleaned = _clean_names(
        names,
        split_people=category == 'drivers',
        category=category,
    )
    if not cleaned:
        return 0

    added = 0
    with connect() as connection:
        init_schema(connection)
        existing_rows = connection.execute(
            'SELECT name, payload FROM dictionary_entries WHERE category = ?',
            (category,),
        ).fetchall()
        existing = set()
        for row in existing_rows:
            name = str(row['name'])
            if category == 'vehicles':
                try:
                    payload = json.loads(row['payload'] or '{}')
                except json.JSONDecodeError:
                    payload = {}
                name = str(payload.get('vehicle_number') or name)
            existing.add(_entry_key(category, name))

        now = datetime.now(timezone.utc).isoformat()
        for name in cleaned:
            if _entry_key(category, name) in existing:
                continue
            extra: dict[str, Any] = {}
            if category == 'vehicles':
                extra = {'vehicle_number': name}
            connection.execute(
                '''
                INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
                VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (str(uuid4()), category, name, f'Импорт {now[:10]}', now, json.dumps(extra, ensure_ascii=False)),
            )
            existing.add(_entry_key(category, name))
            added += 1

    return added


def merge_dictionaries(payload: dict[str, Any]) -> dict[str, int]:
    mapping = {
        'cargos': 'cargos',
        'receivers': 'receivers',
        'shippers': 'shippers',
        'carriers': 'carriers',
        'vehicles': 'vehicles',
        'drivers': 'drivers',
    }
    result: dict[str, int] = {}
    for source_key, category in mapping.items():
        values = payload.get(source_key) or []
        if not isinstance(values, list) or not values:
            continue

        if category == 'vehicles' and isinstance(values[0], dict):
            changed = merge_vehicle_records(values)
        else:
            changed = merge_dictionary_names(category, [str(name) for name in values])

        if changed:
            result[category] = changed
    return result


def format_import_message(source: str, fetched: dict[str, Any], added: dict[str, int]) -> str:
    fetched_total = sum(len(values) for values in fetched.values() if isinstance(values, list))
    added_total = sum(added.values())

    if fetched_total == 0:
        return f'В базе {source} не найдено записей для импорта.'

    details: list[str] = []
    for key, label in CATEGORY_LABELS.items():
        fetched_count = len(fetched.get(key) or [])
        if not fetched_count:
            continue
        added_count = added.get(key, 0)
        details.append(f'{label}: {added_count} новых из {fetched_count}')

    if added_total == 0:
        summary = ', '.join(
            f'{len(fetched.get(key) or [])} {CATEGORY_LABELS[key]}'
            for key in CATEGORY_LABELS
            if fetched.get(key)
        )
        return f'Все записи уже есть в справочниках ({summary}).'

    return f'Импорт из {source}: ' + '; '.join(details)
