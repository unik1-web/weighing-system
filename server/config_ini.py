import configparser
import io
import os
from typing import Any

CONFIG_SECTION = 'settings'
BACKUP_SECTION = 'backup'
DATABASE_SECTION = 'database'


def read_ini_section(path: str, section: str) -> dict[str, str]:
    if not os.path.isfile(path):
        return {}

    parser = configparser.ConfigParser(interpolation=None)
    parser.read(path, encoding='utf-8')
    if section not in parser:
        return {}
    return {str(key): str(value) for key, value in parser[section].items()}


def write_ini_section(path: str, section: str, values: dict[str, Any]) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)

    parser = configparser.ConfigParser(interpolation=None)
    if os.path.isfile(path):
        parser.read(path, encoding='utf-8')

    parser[section] = {str(key): str(value) for key, value in values.items()}

    temp_path = path + '.tmp'
    with open(temp_path, 'w', encoding='utf-8') as handle:
        parser.write(handle)
    os.replace(temp_path, path)


def dump_ini(sections: dict[str, dict[str, Any]]) -> str:
    parser = configparser.ConfigParser(interpolation=None)
    for section, values in sections.items():
        parser[section] = {str(key): str(value) for key, value in values.items()}

    buffer = io.StringIO()
    parser.write(buffer)
    return buffer.getvalue()


def parse_ini(text: str) -> dict[str, dict[str, str]]:
    parser = configparser.ConfigParser(interpolation=None)
    parser.read_file(io.StringIO(text))
    result: dict[str, dict[str, str]] = {}
    for section in parser.sections():
        result[section] = {str(key): str(value) for key, value in parser[section].items()}
    return result
