import os
from datetime import datetime

try:
    from pypxlib import Table
except ImportError:  # pragma: no cover
    Table = None

from text_encoding import decode_db_text, format_vehicle_plate, is_readable_name, looks_like_mojibake, split_person_names

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENCODING = 'cp1251'
DEFAULT_LABEL = '—'
UNDEFINED_LABELS = {
    'не определено',
    'не определён',
    'не определена',
}


def resolve_metra_db_dir(db_path: str) -> str:
    cleaned = db_path.strip()
    if not cleaned:
        return ''

    if os.path.isabs(cleaned):
        resolved = cleaned
    else:
        resolved = os.path.join(PROJECT_ROOT, cleaned.replace('/', os.sep))

    if os.path.isdir(resolved):
        return resolved

    if os.path.isfile(resolved):
        return os.path.dirname(resolved)

    return resolved


def resolve_metra_db_path(db_path: str) -> str:
    db_dir = resolve_metra_db_dir(db_path)
    if not db_dir:
        return ''

    if os.path.isfile(db_path.strip()) and os.path.isabs(db_path.strip()):
        return os.path.abspath(db_path.strip())

    for candidate in ('TWeights.db', 'TWeights.DB', 'tweights.db'):
        file_path = os.path.join(db_dir, candidate)
        if os.path.isfile(file_path):
            return file_path

    if os.path.isfile(db_dir):
        return db_dir

    raise FileNotFoundError(f'В каталоге не найден TWeights.db: {db_dir}')


def _safe_timestamp(row, field_name: str) -> str | None:
    try:
        value = row[field_name]
        if not value:
            return None
        if isinstance(value, datetime):
            if value.year < 1900:
                return None
            return value.strftime('%Y-%m-%d %H:%M:%S')
        return str(value)
    except Exception:
        return None


def _to_kg(value) -> float | None:
    if value is None:
        return None
    number = float(value)
    if number <= 0:
        return None
    return round(number * 1000)


def _clean_text(value) -> str:
    text = decode_db_text(value)
    if not text:
        return ''
    if text.casefold() in UNDEFINED_LABELS:
        return ''
    if looks_like_mojibake(text):
        return ''
    return text


def _lookup_name(mapping: dict[int, str], key, default: str = DEFAULT_LABEL) -> str:
    if key is None:
        return default
    try:
        normalized_key = int(key)
    except (TypeError, ValueError):
        return default
    name = _clean_text(mapping.get(normalized_key, ''))
    return name or default


def _load_dictionary(db_dir: str, file_name: str, id_field: str, name_field: str) -> dict[int, str]:
    path = os.path.join(db_dir, file_name)
    if not os.path.isfile(path):
        return {}

    table = Table(path, encoding=ENCODING)
    result: dict[int, str] = {}
    try:
        for row in table:
            try:
                key = int(row[id_field])
            except (TypeError, ValueError):
                continue
            result[key] = _clean_text(row[name_field])
    finally:
        table.close()
    return result


def _load_price_dictionary(db_dir: str) -> dict[int, float]:
    path = os.path.join(db_dir, 'TypeMerc.DB')
    if not os.path.isfile(path):
        return {}

    table = Table(path, encoding=ENCODING)
    result: dict[int, float] = {}
    try:
        for row in table:
            try:
                key = int(row['MerchNo'])
                result[key] = float(row['PriceMerch'] or 0)
            except (TypeError, ValueError):
                continue
    finally:
        table.close()
    return result


def load_metra_dictionaries(db_dir: str) -> dict[str, dict[int, str]]:
    return {
        'merchants': _load_dictionary(db_dir, 'TypeMerc.DB', 'MerchNo', 'TypeMerch'),
        'recipients': _load_dictionary(db_dir, 'TypeRecp.DB', 'RecipNo', 'TypeRecip'),
        'carriers': _load_dictionary(db_dir, 'TypeCatr.DB', 'CaterNo', 'TypeCater'),
        'operations': _load_dictionary(db_dir, 'TypeOper.DB', 'OperNo', 'TypeOper'),
        'drivers': _load_metra_driver_dictionary(db_dir),
    }


def _load_metra_driver_dictionary(db_dir: str) -> dict[int, str]:
    candidates = (
        ('TypeDriver.DB', 'DriverNo', 'DriverName'),
        ('TypeDriver.DB', 'DriverNo', 'TypeDriver'),
        ('TypeVodit.DB', 'VoditNo', 'VoditName'),
        ('TypeVodit.DB', 'VoditNo', 'TypeVodit'),
        ('Drivers.DB', 'DriverNo', 'DriverName'),
    )
    for file_name, id_field, name_field in candidates:
        mapping = _load_dictionary(db_dir, file_name, id_field, name_field)
        if mapping:
            return mapping
    return {}


def _collect_driver_names_from_weights(resolved: str) -> set[str]:
    if not resolved or not os.path.isfile(resolved) or Table is None:
        return set()

    names: set[str] = set()
    table = Table(resolved, encoding=ENCODING)
    try:
        fields = set(table.fields.keys())
        for row in table:
            for field in ('Comment', 'Comment2', 'Name1CID'):
                if field not in fields:
                    continue
                cleaned = _clean_text(row[field])
                if not cleaned:
                    continue
                for part in split_person_names(cleaned):
                    if part and _looks_like_driver_name(part):
                        names.add(part)
    finally:
        table.close()
    return names


def _looks_like_driver_name(value: str) -> bool:
    text = _clean_text(value)
    if not text or len(text) < 4 or len(text) > 80:
        return False
    if not is_readable_name(text):
        return False
    lowered = text.casefold()
    if lowered in UNDEFINED_LABELS:
        return False
    if any(token in lowered for token in ('наклад', 'invoice', 'груз', 'тонн', '№', 'прицеп')):
        return False
    parts = text.split()
    if len(parts) < 2:
        return False
    return any(ch.isalpha() for ch in text)


def _resolve_cargo_name(row, dictionaries: dict[str, dict[int, str]]) -> str:
    for field in ('Comment', 'Comment2'):
        comment = _clean_text(row[field])
        if comment:
            return comment

    operation = _lookup_name(dictionaries['operations'], row['OperNo'], default='')
    if operation:
        return operation

    return DEFAULT_LABEL


def test_metra_connection(db_path: str) -> int:
    if Table is None:
        raise RuntimeError('Модуль pypxlib не установлен. Выполните: pip install pypxlib')

    resolved = resolve_metra_db_path(db_path)
    if not resolved:
        raise ValueError('Не указан путь к базе Metra')
    if not os.path.exists(resolved):
        raise FileNotFoundError(f'Файл базы не найден: {resolved}')

    table = Table(resolved, encoding=ENCODING)
    try:
        return len(table)
    finally:
        table.close()


def fetch_metra_dictionary_names(db_path: str) -> dict[str, list[str]]:
    db_dir = resolve_metra_db_dir(db_path)
    if not db_dir or not os.path.isdir(db_dir):
        raise FileNotFoundError(f'Каталог базы Metra не найден: {db_path}')

    dictionaries = load_metra_dictionaries(db_dir)
    cargos = set()
    shippers = set()
    receivers = set()
    carriers = set()
    drivers = set()

    for name in dictionaries['merchants'].values():
        cleaned = _clean_text(name)
        if cleaned:
            cargos.add(cleaned)
            shippers.add(cleaned)

    for name in dictionaries['operations'].values():
        cleaned = _clean_text(name)
        if cleaned:
            cargos.add(cleaned)

    for name in dictionaries['recipients'].values():
        cleaned = _clean_text(name)
        if cleaned:
            receivers.add(cleaned)

    for name in dictionaries['carriers'].values():
        cleaned = _clean_text(name)
        if cleaned:
            carriers.add(cleaned)

    for name in dictionaries.get('drivers', {}).values():
        for part in split_person_names(name):
            cleaned = _clean_text(part)
            if cleaned:
                drivers.add(cleaned)

    vehicles: set[str] = set()
    resolved = resolve_metra_db_path(db_path)
    if resolved and os.path.isfile(resolved) and Table is not None:
        table = Table(resolved, encoding=ENCODING)
        try:
            fields = set(table.fields.keys())
            driver_map = dictionaries.get('drivers', {})
            for row in table:
                vehicle = format_vehicle_plate(_clean_text(row['NumTare']))
                if vehicle:
                    vehicles.add(vehicle)
                if 'DriverNo' in fields and row['DriverNo'] is not None:
                    driver_name = _lookup_name(driver_map, row['DriverNo'], default='')
                    if driver_name and driver_name != DEFAULT_LABEL:
                        drivers.add(driver_name)
        finally:
            table.close()

    drivers.update(_collect_driver_names_from_weights(resolved))

    return {
        'cargos': sorted(cargos, key=str.casefold),
        'shippers': sorted(shippers, key=str.casefold),
        'receivers': sorted(receivers, key=str.casefold),
        'carriers': sorted(carriers, key=str.casefold),
        'vehicles': sorted(vehicles, key=str.casefold),
        'drivers': sorted(drivers, key=str.casefold),
    }


def fetch_metra_items(db_path: str, date_str: str) -> list[dict]:
    if Table is None:
        raise RuntimeError('Модуль pypxlib не установлен. Выполните: pip install pypxlib')

    db_dir = resolve_metra_db_dir(db_path)
    resolved = resolve_metra_db_path(db_path)
    if not resolved:
        raise ValueError('Не указан путь к базе Metra')
    if not os.path.exists(resolved):
        raise FileNotFoundError(f'Файл базы не найден: {resolved}')

    target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    dictionaries = load_metra_dictionaries(db_dir)
    merchant_prices = _load_price_dictionary(db_dir)

    table = Table(resolved, encoding=ENCODING)
    items: list[dict] = []

    try:
        for row in table:
            datetime_brutto = _safe_timestamp(row, 'DateTime')
            if not datetime_brutto:
                continue

            try:
                record_date = datetime.strptime(datetime_brutto[:19], '%Y-%m-%d %H:%M:%S').date()
            except ValueError:
                continue

            if record_date != target_date:
                continue

            brutto = float(row['Brutto'] or 0)
            tare = float(row['EntryTare'] or row['Tare'] or 0)
            tonnage = float(row['Tonnage'] or 0)
            netto = tonnage if tonnage > 0 else max(0.0, brutto - tare)

            if brutto <= 0:
                continue

            merch_no = row['MerchNo']
            row_price = float(row['Price'] or 0)
            merchant_price = merchant_prices.get(int(merch_no), 0) if merch_no is not None else 0
            price = row_price if row_price > 0 else merchant_price

            vehicle_number = format_vehicle_plate(_clean_text(row['NumTare']) or '') or DEFAULT_LABEL
            trailer_number = _clean_text(row['TrailerNum'])

            items.append({
                'rec_no': int(row['RecNo']),
                'datetimebrutto': datetime_brutto,
                'datetimetara': _safe_timestamp(row, 'DateTime2') or '',
                'vehicle_number': vehicle_number,
                'vehicle_brand': '',
                'trailer_number': trailer_number,
                'driver_name': DEFAULT_LABEL,
                'cargo_name': _resolve_cargo_name(row, dictionaries),
                'shipper_name': _lookup_name(dictionaries['merchants'], merch_no),
                'receiver_name': _lookup_name(dictionaries['recipients'], row['RecipNo']),
                'carrier_name': _lookup_name(dictionaries['carriers'], row['CaterNo']),
                'price': price,
                'gross_weight': _to_kg(brutto),
                'tare_weight': _to_kg(tare),
                'net_weight': _to_kg(netto),
                'operator_name': _clean_text(row['OperName']) or DEFAULT_LABEL,
                'invoice': _clean_text(row['Invoice']),
            })
    finally:
        table.close()

    return items
