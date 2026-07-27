const DEFAULT_VEHICLE_REGION = '56';
const PLATE_LETTERS = 'АВЕКМНОРСТУХ';

const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  N: 'Н',
  O: 'О',
  P: 'Р',
  T: 'Т',
  U: 'У',
  V: 'В',
  X: 'Х',
  Y: 'У',
};

function compactPlate(number: string): string {
  const upper = number
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, '')
    .split('')
    .map((char) => LATIN_TO_CYRILLIC[char] ?? char)
    .join('');
  return upper;
}

function hasRegionSuffix(compact: string): boolean {
  if (!/\d{2,3}$/.test(compact)) return false;
  const prefix = compact.replace(/\d{2,3}$/, '');
  return prefix.length > 0 && /[A-ZА-ЯЁ]$/u.test(prefix.slice(-1));
}

function formatPlateBody(body: string): string {
  const standard = body.match(new RegExp(`^([${PLATE_LETTERS}]\\d{3})([${PLATE_LETTERS}]{2})$`, 'u'));
  if (standard) {
    return `${standard[1]}${standard[2]}`;
  }

  const digitsLetters = body.match(new RegExp(`^(\\d+)([${PLATE_LETTERS}]+)$`, 'u'));
  if (digitsLetters) {
    return `${digitsLetters[1]}${digitsLetters[2]}`;
  }

  return body;
}

export function normalizeVehicleKey(number: string): string {
  let compact = compactPlate(number);
  if (!compact) return '';
  if (!hasRegionSuffix(compact)) {
    compact = `${compact}${DEFAULT_VEHICLE_REGION}`;
  }
  return compact.toLowerCase();
}

export function formatVehiclePlate(number: string): string {
  let compact = compactPlate(number);
  if (!compact) return '';

  if (!hasRegionSuffix(compact)) {
    compact = `${compact}${DEFAULT_VEHICLE_REGION}`;
  }

  const regionMatch = compact.match(/(\d{2,3})$/);
  if (!regionMatch || regionMatch.index === undefined) {
    return compact;
  }

  const body = compact.slice(0, regionMatch.index);
  const region = regionMatch[1];
  return `${formatPlateBody(body)}${region}`;
}
