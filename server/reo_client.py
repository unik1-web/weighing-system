import json

import requests


def build_reo_test_payload(object_id: str, access_key: str) -> dict:
    return {
        'objectId': object_id,
        'accessKey': access_key,
        'weightControls': [],
    }


def post_reo_import(url: str, payload: dict, filename: str = 'data.json') -> requests.Response:
    """REO API принимает только multipart/form-data с JSON-файлом (не application/json)."""
    content = json.dumps(payload, ensure_ascii=False, indent=4)
    files = {
        'file': (filename, content.encode('utf-8'), 'application/json'),
    }
    return requests.post(url, files=files, timeout=60)


def is_reo_test_successful(response: requests.Response) -> bool:
    """Пустой weightControls даёт 422 — для проверки связи это нормально (как в Reosend)."""
    if response.status_code == 200:
        return True
    if response.status_code == 422:
        return True
    return False


def format_reo_error(response: requests.Response) -> str:
    text = (response.text or '').strip()
    if not text:
        return f'HTTP {response.status_code}'
    if len(text) > 500:
        return f'HTTP {response.status_code}: {text[:500]}...'
    return f'HTTP {response.status_code}: {text}'
