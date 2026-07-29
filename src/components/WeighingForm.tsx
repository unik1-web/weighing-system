import { useState, useEffect, useCallback, useRef } from 'react';
import { type WeighingTicket, type WeightSource, type TicketStatus } from '@/lib/storage';
import { TicketStorage } from '@/lib/storage';
import { flushDatabaseSync } from '@/lib/storage-sync';
import { logger } from '@/lib/logger';
import { useDictionary } from '@/hooks/useDictionary';
import { useAuth } from '@/hooks/useAuth';
import { ScalePanel } from '@/components/ScalePanel';
import { formatVehiclePlate } from '@/lib/vehicle-plate';
import { formatPersonName, formatVehicleBrand } from '@/lib/text-format';
import { SCALE_DEVICES, type ScaleDeviceId } from '@/lib/scales';
import { Save, FileText, RotateCcw, AlertCircle, CheckCircle2, ClipboardList, Printer } from 'lucide-react';

interface Props {
  onSaved: (ticket: WeighingTicket) => void;
}

type WeighingPhase = 'gross' | 'tare';

export function WeighingForm({ onSaved }: Props) {
  const { displayName } = useAuth();
  const vehicles = useDictionary('vehicles');
  const drivers = useDictionary('drivers');
  const cargos = useDictionary('cargos');
  const shippers = useDictionary('shippers');
  const receivers = useDictionary('receivers');
  const carriers = useDictionary('carriers');

  const [phase, setPhase] = useState<WeighingPhase>('gross');
  const [deviceId, setDeviceId] = useState<ScaleDeviceId>('microsim-m0601');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [trailerNumber, setTrailerNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [cargoName, setCargoName] = useState('');
  const [shipperName, setShipperName] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [price, setPrice] = useState('');
  const [vatRate, setVatRate] = useState('20');
  const [grossWeight, setGrossWeight] = useState<number | null>(null);
  const [tareWeight, setTareWeight] = useState<number | null>(null);
  const [grossSource, setGrossSource] = useState<WeightSource>('manual');
  const [tareSource, setTareSource] = useState<WeightSource>('manual');
  const [grossRaw, setGrossRaw] = useState<string | null>(null);
  const [tareRaw, setTareRaw] = useState<string | null>(null);
  const [grossDatetime, setGrossDatetime] = useState<string | null>(null);
  const [tareDatetime, setTareDatetime] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastTicket, setLastTicket] = useState<WeighingTicket | null>(null);

  const netWeight = grossWeight != null && tareWeight != null
    ? Math.max(0, grossWeight - tareWeight)
    : null;
  const totalAmount = netWeight != null && price
    ? (netWeight / 1000) * parseFloat(price)
    : null;

  const resetFormFields = useCallback(() => {
    setPhase('gross');
    setVehicleNumber('');
    setVehicleBrand('');
    setTrailerNumber('');
    setDriverName('');
    setCargoName('');
    setShipperName('');
    setReceiverName('');
    setCarrierName('');
    setPrice('');
    setVatRate('20');
    setGrossWeight(null);
    setTareWeight(null);
    setGrossSource('manual');
    setTareSource('manual');
    setGrossRaw(null);
    setTareRaw(null);
    setGrossDatetime(null);
    setTareDatetime(null);
    setNotes('');
    setError(null);
  }, []);

  const reset = useCallback(() => {
    resetFormFields();
    setSuccess(null);
    setLastTicket(null);
  }, [resetFormFields]);

  useEffect(() => {
    if (cargoName) {
      const cargo = cargos.entries.find((c) => c.name === cargoName);
      if (cargo?.default_price != null && !price) {
        setPrice(cargo.default_price.toString());
      }
    }
  }, [cargoName, cargos.entries, price]);

  useEffect(() => {
    if (vehicleNumber) {
      const vehicle = vehicles.entries.find((v) => v.vehicle_number === vehicleNumber);
      if (vehicle) {
        if (vehicle.vehicle_brand && !vehicleBrand) setVehicleBrand(vehicle.vehicle_brand);
        if (vehicle.default_tare_weight != null && tareWeight == null) {
          setTareWeight(vehicle.default_tare_weight);
          setTareSource('manual');
        }
      }
    }
  }, [vehicleNumber, vehicles.entries, tareWeight, vehicleBrand]);

  const captureGross = (w: number, raw: string) => {
    setGrossWeight(w);
    setGrossSource('instrument');
    setGrossRaw(raw);
    setGrossDatetime(new Date().toISOString());
  };

  const captureTare = (w: number, raw: string) => {
    setTareWeight(w);
    setTareSource('instrument');
    setTareRaw(raw);
    setTareDatetime(new Date().toISOString());
  };

  const handleSave = async (status: TicketStatus) => {
    // Ref guard: React state `saving` updates too late to block double-clicks in the same tick.
    if (savingRef.current) return;

    setError(null);
    setSuccess(null);

    if (!vehicleNumber || !driverName || !cargoName || !shipperName || !receiverName || !carrierName) {
      setError('Заполните все обязательные поля.');
      return;
    }
    if (grossWeight == null) {
      setError('Введите брутто вес.');
      return;
    }
    if (status === 'completed' && tareWeight == null) {
      setError('Для завершения взвешивания введите тару.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const now = new Date().toISOString();
    const normalizedVehicleNumber = formatVehiclePlate(vehicleNumber);
    const payload: Omit<WeighingTicket, 'id' | 'ticket_number' | 'created_at' | 'reo_status' | 'reo_sent_at'> = {
      vehicle_number: normalizedVehicleNumber,
      vehicle_brand: formatVehicleBrand(vehicleBrand),
      trailer_number: trailerNumber,
      driver_name: formatPersonName(driverName),
      cargo_name: cargoName,
      shipper_name: shipperName,
      receiver_name: receiverName,
      carrier_name: carrierName,
      price: parseFloat(price) || 0,
      vat_rate: parseFloat(vatRate) || 0,
      gross_weight: grossWeight,
      tare_weight: tareWeight,
      net_weight: netWeight,
      total_amount: totalAmount,
      gross_source: grossSource,
      tare_source: tareSource,
      gross_raw: grossRaw,
      tare_raw: tareRaw,
      gross_datetime: grossDatetime,
      tare_datetime: tareDatetime,
      scale_device: SCALE_DEVICES[deviceId].name,
      operator_id: null,
      operator_name: displayName,
      status,
      completed_at: status === 'completed' ? now : null,
      notes,
    };

    try {
      const ticket = TicketStorage.create(payload);
      await flushDatabaseSync();
      logger.info('weighing', `Сохранена запись №${ticket.ticket_number}`, {
        status,
        vehicle_number: ticket.vehicle_number,
        cargo_name: ticket.cargo_name,
      });
      setLastTicket(ticket);
      setSuccess(status === 'completed' ? 'Взвешивание завершено и сохранено.' : 'Запись сохранена как незавершённая.');
      onSaved(ticket);
      resetFormFields();
    } catch (err: any) {
      setError(err.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handlePrint = () => {
    if (!lastTicket) return;
    window.dispatchEvent(new CustomEvent('print-ticket', { detail: lastTicket }));
  };

  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition';
  const labelClass = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] min-w-0">
      <div className="space-y-5 min-w-0">
        {/* Ticket info */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ClipboardList size={20} className="text-blue-600" />
              <h2 className="text-base font-semibold text-slate-800">Данные взвешивания</h2>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              Весовщик: {displayName}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Номер автомобиля *</label>
              <input list="vehicles-list" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="А123ВС77" className={inputClass} />
              <datalist id="vehicles-list">
                {vehicles.entries.map((v) => <option key={v.id} value={v.vehicle_number} />)}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>Марка автомобиля</label>
              <input list="brands-list" value={vehicleBrand} onChange={(e) => setVehicleBrand(e.target.value)} placeholder="КамАЗ-5320" className={inputClass} />
              <datalist id="brands-list">
                {vehicles.entries.filter((v) => v.vehicle_brand).map((v) => <option key={v.id} value={v.vehicle_brand} />)}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>Номер прицепа</label>
              <input value={trailerNumber} onChange={(e) => setTrailerNumber(e.target.value)} placeholder="Прицеп (если есть)" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>ФИО водителя *</label>
              <input list="drivers-list" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Иванов И.И." className={inputClass} />
              <datalist id="drivers-list">
                {drivers.entries.map((d) => <option key={d.id} value={d.name} />)}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>Наименование груза *</label>
              <input list="cargos-list" value={cargoName} onChange={(e) => setCargoName(e.target.value)} placeholder="Выберите или введите" className={inputClass} />
              <datalist id="cargos-list">
                {cargos.entries.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>Цена за приёмку (за тонну), ₽ *</label>
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Грузоотправитель *</label>
              <input list="shippers-list" value={shipperName} onChange={(e) => setShipperName(e.target.value)} placeholder="Выберите или введите" className={inputClass} />
              <datalist id="shippers-list">
                {shippers.entries.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>Грузополучатель *</label>
              <input list="receivers-list" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Выберите или введите" className={inputClass} />
              <datalist id="receivers-list">
                {receivers.entries.map((r) => <option key={r.id} value={r.name} />)}
              </datalist>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Грузоперевозчик *</label>
              <input list="carriers-list" value={carrierName} onChange={(e) => setCarrierName(e.target.value)} placeholder="Выберите или введите" className={inputClass} />
              <datalist id="carriers-list">
                {carriers.entries.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>Ставка НДС, %</label>
              <input type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)} placeholder="20" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Примечание</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Дополнительная информация" className={`${inputClass} resize-none`} />
            </div>
          </div>
        </div>

        {/* Weight entry */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-blue-600" />
            <h2 className="text-base font-semibold text-slate-800">Показания весов</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className={`rounded-xl border-2 p-4 transition ${phase === 'gross' ? 'border-blue-500 bg-blue-50/30' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600">БРУТТО</span>
                {grossSource === 'instrument' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">ПРИБОР</span>}
              </div>
              <input type="number" value={grossWeight ?? ''} onChange={(e) => { setGrossWeight(e.target.value ? parseFloat(e.target.value) : null); setGrossSource('manual'); setGrossRaw(null); setGrossDatetime(new Date().toISOString()); }} onFocus={() => setPhase('gross')} placeholder="0" className="w-full bg-transparent text-2xl font-bold tabular-nums text-slate-800 outline-none" />
              <span className="text-xs text-slate-400">кг</span>
            </div>
            <div className={`rounded-xl border-2 p-4 transition ${phase === 'tare' ? 'border-blue-500 bg-blue-50/30' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600">ТАРА</span>
                {tareSource === 'instrument' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">ПРИБОР</span>}
              </div>
              <input type="number" value={tareWeight ?? ''} onChange={(e) => { setTareWeight(e.target.value ? parseFloat(e.target.value) : null); setTareSource('manual'); setTareRaw(null); setTareDatetime(new Date().toISOString()); }} onFocus={() => setPhase('tare')} placeholder="0" className="w-full bg-transparent text-2xl font-bold tabular-nums text-slate-800 outline-none" />
              <span className="text-xs text-slate-400">кг</span>
            </div>
            <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600">НЕТТО</span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-slate-800">{netWeight != null ? netWeight.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—'}</div>
              <span className="text-xs text-slate-400">кг</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-4 text-white">
            <div>
              <div className="text-xs font-medium text-blue-100">Итого к оплате</div>
              <div className="text-2xl font-bold tabular-nums">{totalAmount != null ? `${totalAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽` : '—'}</div>
            </div>
            <div className="text-right text-xs text-blue-100">
              <div>Нетто: {netWeight != null ? `${(netWeight / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} т` : '—'}</div>
              <div>Цена: {price ? `${parseFloat(price).toLocaleString('ru-RU')} ₽/т` : '—'}</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> {success}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button onClick={() => handleSave('completed')} disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50">
            <Save size={18} /> {saving ? 'Сохранение...' : 'Сохранить и завершить'}
          </button>
          <button onClick={() => handleSave('open')} disabled={saving} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
            <FileText size={18} /> Сохранить как незавершённое
          </button>
          {lastTicket && (
            <button onClick={handlePrint} className="flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-6 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100">
              <Printer size={18} /> Печать акта
            </button>
          )}
          <button onClick={reset} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            <RotateCcw size={18} /> Очистить
          </button>
        </div>
      </div>

      <div className="space-y-4 min-w-0">
        <ScalePanel onCapture={phase === 'gross' ? captureGross : captureTare} label={phase === 'gross' ? 'Зафиксировать брутто' : 'Зафиксировать тару'} capturedWeight={phase === 'gross' ? grossWeight : tareWeight} deviceId={deviceId} onDeviceChange={setDeviceId} />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Порядок работы</h3>
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">1</span> Заполните данные об автомобиле и грузе</li>
            <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">2</span> Выберите прибор и подключите COM-порт</li>
            <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">3</span> Зафиксируйте брутто и тару</li>
            <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">4</span> Сохраните талон и распечатайте акт</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
