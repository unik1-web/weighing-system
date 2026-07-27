import os
from datetime import datetime

try:
    from pypxlib import Table
except ImportError:  # pragma: no cover
    Table = None

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
    if value is None:
        return ''
    text = str(value).strip()
    if not text:
        return ''
    if text.casefold() in UNDEFINED_LABELS:
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
    }


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

            vehicle_number = _clean_text(row['NumTare']) or DEFAULT_LABEL
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
