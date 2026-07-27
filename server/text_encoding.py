import re


def cyrillic_ratio(text: str) -> float:
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return 0.0
    cyrillic = sum(1 for char in letters if '\u0400' <= char <= '\u04FF')
    return cyrillic / len(letters)


def looks_like_mojibake(text: str) -> bool:
    if not text:
        return False

    markers = (
        'РЎ', 'РЃ', 'Р°', 'Р±', 'P°', 'P±', 'PsP', 'PIs', 'CЂ', 'PЎ', 'CЂPs', 'Pµ', 'P»',
        'Ð', 'Ñ', 'Ò', 'Ó', 'Ô', 'Õ', 'Ö', '×', 'Ø', 'Ù', 'Ú', 'Û', 'Ü', 'Ý', 'Þ', 'ß',
    )
    if any(marker in text for marker in markers):
        if cyrillic_ratio(text) < 0.55:
            return True

    if text.count('P') >= 2 and any('\u0400' <= char <= '\u04FF' for char in text):
        return True
    if text.count('Р') >= 3 and cyrillic_ratio(text) < 0.55:
        return True
    return False


def _text_candidates(text: str) -> list[str]:
    candidates = [text]
    for encoding in ('latin1', 'cp1252'):
        try:
            candidates.append(text.encode(encoding).decode('utf-8').strip())
        except (UnicodeDecodeError, UnicodeEncodeError):
            continue
    try:
        candidates.append(text.encode('latin1').decode('cp1251').strip())
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass

    unique: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        unique.append(candidate)
    return unique


def _text_quality(text: str) -> float:
    if not text or looks_like_mojibake(text):
        return -1.0

    letters = [char for char in text if char.isalpha()]
    if not letters:
        return -1.0

    ratio = cyrillic_ratio(text)
    if ratio >= 0.4:
        return ratio + 0.5
    if text.isascii():
        return 0.4
    return ratio


def decode_db_text(value) -> str:
    if value is None:
        return ''

    if isinstance(value, bytes):
        for encoding in ('cp1251', 'utf-8'):
            try:
                return value.decode(encoding).strip()
            except UnicodeDecodeError:
                continue
        return value.decode('cp1251', errors='ignore').strip()

    text = str(value).strip()
    if not text:
        return ''

    best = max(_text_candidates(text), key=_text_quality)
    if _text_quality(best) >= 0:
        return best
    return text


def is_readable_name(text: str) -> bool:
    cleaned = decode_db_text(text)
    if not cleaned or len(cleaned) < 2:
        return False
    if looks_like_mojibake(cleaned):
        return False

    allowed = sum(1 for char in cleaned if char.isalnum() or char in ' ."-№«»()')
    if allowed / len(cleaned) < 0.8:
        return False

    if cyrillic_ratio(cleaned) >= 0.4:
        return True

    return cleaned.isascii()


def split_person_names(value) -> list[str]:
    text = decode_db_text(value)
    if not text:
        return []

    person_re = re.compile(r'[А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.(?:\s*[А-ЯЁ]\.)?')
    result: list[str] = []
    seen: set[str] = set()

    for chunk in re.split(r'[,;/|]+|\n+', text):
        chunk = chunk.strip()
        if not chunk:
            continue

        matches = [match.group(0).strip() for match in person_re.finditer(chunk)]
        parts = matches if matches else [chunk]

        for part in parts:
            name = ' '.join(part.split())
            if not name:
                continue
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            result.append(name)

    return result


DEFAULT_VEHICLE_REGION = '56'
PLATE_LETTERS = 'АВЕКМНОРСТУХ'
LATIN_TO_CYRILLIC = str.maketrans({
    'A': 'А',
    'B': 'В',
    'C': 'С',
    'E': 'Е',
    'H': 'Н',
    'K': 'К',
    'M': 'М',
    'N': 'Н',
    'O': 'О',
    'P': 'Р',
    'T': 'Т',
    'U': 'У',
    'V': 'В',
    'X': 'Х',
    'Y': 'У',
})


def _compact_plate(number: str) -> str:
    text = decode_db_text(number).strip().upper().translate(LATIN_TO_CYRILLIC)
    return re.sub(r'[\s\-_]+', '', text)


def _has_region_suffix(compact: str) -> bool:
    if not re.search(r'\d{2,3}$', compact):
        return False
    prefix = re.sub(r'\d{2,3}$', '', compact)
    return bool(prefix) and prefix[-1].isalpha()


def _format_plate_body(body: str) -> str:
    standard = re.fullmatch(rf'([{PLATE_LETTERS}]\d{{3}})([{PLATE_LETTERS}]{{2}})', body)
    if standard:
        return f'{standard.group(1)}{standard.group(2)}'

    digits_letters = re.fullmatch(rf'(\d+)([{PLATE_LETTERS}]+)', body)
    if digits_letters:
        return f'{digits_letters.group(1)}{digits_letters.group(2)}'

    return body


def normalize_vehicle_key(number: str) -> str:
    text = _compact_plate(number)
    if not text:
        return ''
    if not _has_region_suffix(text):
        text = f'{text}{DEFAULT_VEHICLE_REGION}'
    return text.casefold()


def format_vehicle_plate(number: str) -> str:
    compact = _compact_plate(number)
    if not compact:
        return ''

    if not _has_region_suffix(compact):
        compact = f'{compact}{DEFAULT_VEHICLE_REGION}'

    region_match = re.search(r'(\d{2,3})$', compact)
    if not region_match:
        return compact

    body = compact[:region_match.start()]
    region = region_match.group(1)
    formatted_body = _format_plate_body(body)
    return f'{formatted_body}{region}'


def is_readable_vehicle_number(text: str) -> bool:
    cleaned = format_vehicle_plate(text)
    if len(cleaned) < 3:
        return False
    allowed = sum(1 for char in cleaned if char.isalnum())
    return allowed / len(cleaned) >= 0.8


def _capitalize_word(word: str) -> str:
    if not word:
        return ''
    if word[0].isdigit():
        return word
    return word[0].upper() + word[1:].lower()


def _capitalize_initials(word: str) -> str:
    parts = word.split('.')
    formatted: list[str] = []
    for index, part in enumerate(parts):
        if part:
            formatted.append(_capitalize_word(part))
        if index < len(parts) - 1:
            formatted.append('.')
    return ''.join(formatted)


def format_person_name(value) -> str:
    text = ' '.join(decode_db_text(value).strip().split())
    if not text:
        return ''

    words: list[str] = []
    for word in text.split(' '):
        if '.' in word:
            words.append(_capitalize_initials(word))
        else:
            words.append(_capitalize_word(word))
    return ' '.join(words)


def format_vehicle_brand(value) -> str:
    text = ' '.join(decode_db_text(value).strip().split())
    if not text:
        return ''
    return ' '.join(_capitalize_word(word) for word in text.split(' '))

