import os
from datetime import datetime

try:
    from pypxlib import Table
except ImportError:  # pragma: no cover
    Table = None

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resolve_metra_db_path(db_path: str) -> str:
    cleaned = db_path.strip()
    if not cleaned:
        return ''
    if os.path.isabs(cleaned):
        return cleaned
    return os.path.join(PROJECT_ROOT, cleaned.replace('/', os.sep))


def _safe_timestamp(row, field_name: str) -> str | None:
    try:
        value = row[field_name]
        if not value:
            return None
        if isinstance(value, datetime):
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


def test_metra_connection(db_path: str) -> int:
    if Table is None:
        raise RuntimeError('Модуль pypxlib не установлен. Выполните: pip install pypxlib')

    resolved = resolve_metra_db_path(db_path)
    if not resolved:
        raise ValueError('Не указан путь к базе Metra')
    if not os.path.exists(resolved):
        raise FileNotFoundError(f'Файл базы не найден: {resolved}')

    table = Table(resolved, encoding='cp1251')
    try:
        return len(table)
    finally:
        table.close()


def fetch_metra_items(db_path: str, date_str: str) -> list[dict]:
    if Table is None:
        raise RuntimeError('Модуль pypxlib не установлен. Выполните: pip install pypxlib')

    resolved = resolve_metra_db_path(db_path)
    if not resolved:
        raise ValueError('Не указан путь к базе Metra')
    if not os.path.exists(resolved):
        raise FileNotFoundError(f'Файл базы не найден: {resolved}')

    target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    table = Table(resolved, encoding='cp1251')
    items: list[dict] = []

    try:
        for row in table:
            datetime_brutto = _safe_timestamp(row, 'DateTime')
            if not datetime_brutto:
                continue

            record_date = datetime.strptime(datetime_brutto[:19], '%Y-%m-%d %H:%M:%S').date()
            if record_date != target_date:
                continue

            brutto = float(row['Brutto'] or 0)
            tare = float(row['EntryTare'] or row['Tare'] or 0)
            tonnage = float(row['Tonnage'] or 0)
            netto = tonnage if tonnage > 0 else max(0.0, brutto - tare)

            if brutto <= 0:
                continue

            items.append({
                'rec_no': int(row['RecNo']),
                'datetimebrutto': datetime_brutto,
                'datetimetara': _safe_timestamp(row, 'DateTime2') or '',
                'vehicle_number': (row['NumTare'] or '').strip(),
                'gross_weight': _to_kg(brutto),
                'tare_weight': _to_kg(tare),
                'net_weight': _to_kg(netto),
                'operator_name': (row['OperName'] or '').strip(),
                'cargo_name': (row['Comment'] or row['Comment2'] or '—').strip() or '—',
            })
    finally:
        table.close()

    return items
