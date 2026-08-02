import { parseCustomFrame } from '../parse';
import type { ScaleAdapter, ScaleConnectionProfile } from '../types';

const CUSTOM_DEFAULTS: ScaleConnectionProfile = {
  transport: 'web_serial',
  baudRate: 9600,
  parity: 'none',
  dataBits: 8,
  stopBits: 1,
  lineTerminator: '\r\n',
  parseRegex: '',
  parseMask: '',
  parseStableGroup: '',
  parseUnitGroup: '',
  parseSignGroup: '',
  host: '127.0.0.1',
  tcpPort: 9001,
  serialPath: '',
};

export const customAdapter: ScaleAdapter = {
  id: 'custom',
  name: 'Произвольный разбор',
  defaultConnection: () => ({ ...CUSTOM_DEFAULTS }),
  parseFrame: (line, connection) => parseCustomFrame(line, connection),
};
