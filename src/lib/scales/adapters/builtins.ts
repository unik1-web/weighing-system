import { parseUniversalFrame } from '../parse';
import type { ScaleAdapter, ScaleAdapterId, ScaleConnectionProfile } from '../types';

function framing(
  baudRate: number,
  parity: ScaleConnectionProfile['parity'],
  dataBits: ScaleConnectionProfile['dataBits'],
  stopBits: ScaleConnectionProfile['stopBits'],
  lineTerminator: string,
): ScaleConnectionProfile {
  return {
    transport: 'web_serial',
    baudRate,
    parity,
    dataBits,
    stopBits,
    lineTerminator,
  };
}

function makeBuiltin(
  id: Exclude<ScaleAdapterId, 'custom'>,
  name: string,
  defaults: ScaleConnectionProfile,
): ScaleAdapter {
  return {
    id,
    name,
    defaultConnection: () => ({ ...defaults }),
    parseFrame: (line) => parseUniversalFrame(line),
  };
}

export const BUILTIN_ADAPTERS: ScaleAdapter[] = [
  makeBuiltin(
    'microsim-m0601',
    'Микросим М0601',
    framing(9600, 'none', 8, 1, '\r'),
  ),
  makeBuiltin(
    'newton',
    'Ньютон',
    framing(9600, 'none', 8, 1, '\r\n'),
  ),
  makeBuiltin(
    'cas',
    'CAS',
    framing(9600, 'even', 7, 1, '\r\n'),
  ),
  makeBuiltin(
    'midl-mi-vda',
    'Мидл Ми ВДА',
    framing(9600, 'none', 8, 1, '\r\n'),
  ),
];
