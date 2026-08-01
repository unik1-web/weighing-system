import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  type WeighingTicket,
  type WeightSource,
  TicketStorage,
  SettingsStorage,
  VehicleDriversStorage,
  DictionaryStorage,
} from '@/lib/storage';
import { logger } from '@/lib/logger';
import { useDictionary } from '@/hooks/useDictionary';
import { useAuth } from '@/hooks/useAuth';
import { ScalePanel } from '@/components/ScalePanel';
import { formatVehiclePlate } from '@/lib/vehicle-plate';
import { formatPersonName, formatVehicleBrand } from '@/lib/text-format';
import { SCALE_DEVICES, type ScaleDeviceId } from '@/lib/scales';
import {
  type WeighingMode,
  type WeightPhase,
  filterIncompleteDual,
  suggestPhase,
  shouldAutofillTare,
  resolveCaptureSlot,
  slotEditability,
  classifyOpenWeightState,
  emptySlotForOne,
  parseWeightInput,
  validateSingleComplete,
  validateDualFirstPass,
  validateDualComplete,
  netWeight as calcNetWeight,
  totalAmount as calcTotalAmount,
  firstWeightDatetime,
  isMaxTimeExceeded,
} from '@/lib/weighing-mode';
import {
  normalizeWeightSource,
  WEIGHT_SOURCE_LABELS,
} from '@/lib/weight-source';
import {
  resolveVehicle,
  type PlateSource,
} from '@/lib/vehicle-resolve';
import { Save, FileText, RotateCcw, AlertCircle, CheckCircle2, ClipboardList, Printer } from 'lucide-react';

type AutofillTextField = 'vehicle_brand' | 'driver_name' | 'cargo_name' | 'shipper_name';

const EMPTY_AUTO_VALUES: Record<AutofillTextField, string> = {
  vehicle_brand: '',
  driver_name: '',
  cargo_name: '',
  shipper_name: '',
};

const WEIGHT_SOURCE_BADGE_CLASS: Record<WeightSource, string> = {
  instrument: 'rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700',
  manual: 'rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600',
  dictionary: 'rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-sky-700',
  default: 'rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700',
};

function WeightSourceBadge({
  weight,
  source,
}: {
  weight: number | null;
  source: WeightSource;
}) {
  if (weight == null) return null;
  const normalized = normalizeWeightSource(source);
  return (
    <span className={WEIGHT_SOURCE_BADGE_CLASS[normalized]}>
      {WEIGHT_SOURCE_LABELS[normalized]}
    </span>
  );
}

interface Props {
  onSaved: (ticket: WeighingTicket) => void;
  completionTicketId?: string | null;
  onCompletionHandled?: () => void;
}

function weightPresentLabel(ticket: WeighingTicket): string {
  const state = classifyOpenWeightState(ticket);
  if (state === 'zero') return 'нет';
  if (state === 'two') return 'оба';
  if (ticket.gross_weight != null && ticket.gross_weight > 0) return 'брутто';
  return 'тара';
}

export function WeighingForm({ onSaved, completionTicketId = null, onCompletionHandled }: Props) {
  const { displayName } = useAuth();
  const vehicles = useDictionary('vehicles');
  const drivers = useDictionary('drivers');
  const cargos = useDictionary('cargos');
  const shippers = useDictionary('shippers');
  const receivers = useDictionary('receivers');
  const carriers = useDictionary('carriers');

  const [appSettings, setAppSettings] = useState(() => SettingsStorage.getAppSettings());
  const [formMode, setFormMode] = useState<WeighingMode>(() => appSettings.weighing_mode_default);
  const [phaseOverride, setPhaseOverride] = useState(false);
  const [overridePhase, setOverridePhase] = useState<WeightPhase>('gross');
  const [activeField, setActiveField] = useState<WeightPhase>('gross');
  const [completingTicket, setCompletingTicket] = useState<WeighingTicket | null>(null);
  const [incompleteRefresh, setIncompleteRefresh] = useState(0);

  const [deviceId, setDeviceId] = useState<ScaleDeviceId>(
    () => SettingsStorage.getAppSettings().scale_device_id,
  );
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastTicket, setLastTicket] = useState<WeighingTicket | null>(null);
  const [unstableWarning, setUnstableWarning] = useState<string | null>(null);
  const [intervalWarnedForId, setIntervalWarnedForId] = useState<string | null>(null);
  const [liveScaleWeight, setLiveScaleWeight] = useState<number | null>(null);
  const [driverCandidates, setDriverCandidates] = useState<string[]>([]);
  const [plateSource, setPlateSource] = useState<PlateSource | null>(null);
  /** After operator edits/clears tare (or captures instrument), block autofill until vehicle/mode/reset. */
  const tareAutofillBlocked = useRef(false);
  const lastAutoValues = useRef<Record<AutofillTextField, string>>({ ...EMPTY_AUTO_VALUES });
  const textFieldsRef = useRef({
    vehicleBrand: '',
    driverName: '',
    cargoName: '',
    shipperName: '',
  });
  const tareWeightRef = useRef<number | null>(null);
  textFieldsRef.current = { vehicleBrand, driverName, cargoName, shipperName };
  tareWeightRef.current = tareWeight;

  const isCompleting = completingTicket != null;
  // For completion, editability is based on the loaded ticket's original weights for locked slots,
  // but also current form state for zero-weight legacy.
  const editability = useMemo(() => {
    if (!completingTicket) {
      return { grossEditable: true, tareEditable: true };
    }
    const originalState = classifyOpenWeightState(completingTicket);
    if (originalState === 'one') {
      return slotEditability(originalState, completingTicket);
    }
    if (originalState === 'two') {
      return { grossEditable: false, tareEditable: false };
    }
    return { grossEditable: true, tareEditable: true };
  }, [completingTicket]);

  // Threshold hint must use the live instrument weight (same input as capture),
  // not empty form fields (null→0 always suggested tare).
  const suggestedPhase = useMemo(() => {
    if (formMode !== 'dual' || phaseOverride) return null;
    if (liveScaleWeight == null) return null;
    return suggestPhase(liveScaleWeight, appSettings.tara_threshold);
  }, [formMode, phaseOverride, liveScaleWeight, appSettings.tara_threshold]);

  const highlightPhase: WeightPhase = phaseOverride
    ? overridePhase
    : formMode === 'dual' && suggestedPhase
      ? suggestedPhase
      : activeField;

  const netWeightValue =
    grossWeight != null && tareWeight != null ? calcNetWeight(grossWeight, tareWeight) : null;
  const totalAmountValue =
    netWeightValue != null && price ? calcTotalAmount(netWeightValue, parseFloat(price) || 0) : null;

  const incompleteTickets = useMemo(() => {
    void incompleteRefresh;
    return filterIncompleteDual(TicketStorage.getAll());
  }, [incompleteRefresh, success, lastTicket]);

  const showIntervalBanner = useMemo(() => {
    if (!completingTicket) return false;
    const firstIso = firstWeightDatetime(completingTicket);
    return isMaxTimeExceeded(firstIso, new Date().toISOString(), appSettings.max_time_between);
  }, [completingTicket, appSettings.max_time_between]);

  useEffect(() => {
    if (showIntervalBanner && completingTicket && intervalWarnedForId !== completingTicket.id) {
      logger.warn('weighing', 'Превышен max_time_between', {
        ticket_id: completingTicket.id,
        max_time_between: appSettings.max_time_between,
      });
      setIntervalWarnedForId(completingTicket.id);
    }
  }, [showIntervalBanner, completingTicket, intervalWarnedForId, appSettings.max_time_between]);

  const resetFormFields = useCallback(() => {
    tareAutofillBlocked.current = false;
    lastAutoValues.current = { ...EMPTY_AUTO_VALUES };
    setActiveField('gross');
    setPhaseOverride(false);
    setOverridePhase('gross');
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
    setUnstableWarning(null);
    setDriverCandidates([]);
    setPlateSource(null);
  }, []);

  const exitCompletion = useCallback(() => {
    setCompletingTicket(null);
    setIntervalWarnedForId(null);
    onCompletionHandled?.();
  }, [onCompletionHandled]);

  const reset = useCallback(() => {
    resetFormFields();
    setSuccess(null);
    setLastTicket(null);
    if (isCompleting) {
      exitCompletion();
      const settings = SettingsStorage.getAppSettings();
      setAppSettings(settings);
      setFormMode(settings.weighing_mode_default);
    }
  }, [resetFormFields, isCompleting, exitCompletion]);

  const loadTicketForCompletion = useCallback(
    (ticketId: string) => {
      const ticket = TicketStorage.getById(ticketId);
      if (!ticket) {
        setError('Тикет не найден. Обновите список.');
        exitCompletion();
        return;
      }
      if (ticket.status === 'completed') {
        setError('Тикет уже завершён.');
        exitCompletion();
        setIncompleteRefresh((n) => n + 1);
        return;
      }

      tareAutofillBlocked.current = false;
      lastAutoValues.current = { ...EMPTY_AUTO_VALUES };
      setCompletingTicket(ticket);
      setFormMode('dual');
      setSuccess(null);
      setError(null);
      setVehicleNumber(ticket.vehicle_number);
      setVehicleBrand(ticket.vehicle_brand);
      setTrailerNumber(ticket.trailer_number);
      setDriverName(ticket.driver_name);
      setCargoName(ticket.cargo_name);
      setShipperName(ticket.shipper_name);
      setReceiverName(ticket.receiver_name);
      setCarrierName(ticket.carrier_name);
      setPrice(ticket.price ? String(ticket.price) : '');
      setVatRate(String(ticket.vat_rate ?? 20));
      setGrossWeight(ticket.gross_weight);
      setTareWeight(ticket.tare_weight);
      setGrossSource(ticket.gross_source);
      setTareSource(ticket.tare_source);
      setGrossRaw(ticket.gross_raw);
      setTareRaw(ticket.tare_raw);
      setGrossDatetime(ticket.gross_datetime);
      setTareDatetime(ticket.tare_datetime);
      setNotes(ticket.notes);
      setPlateSource(ticket.plate_source ?? null);
      setDriverCandidates([]);

      const state = classifyOpenWeightState(ticket);
      if (state === 'one') {
        // Force phase onto the empty slot so threshold cannot target the locked one.
        const empty = emptySlotForOne(ticket) ?? 'gross';
        setPhaseOverride(true);
        setOverridePhase(empty);
        setActiveField(empty);
      } else {
        setPhaseOverride(false);
        setOverridePhase('gross');
        setActiveField('gross');
      }
    },
    [exitCompletion],
  );

  useEffect(() => {
    if (completionTicketId) {
      loadTicketForCompletion(completionTicketId);
    }
  }, [completionTicketId, loadTicketForCompletion]);

  useEffect(() => {
    if (cargoName) {
      const cargo = cargos.entries.find((c) => c.name === cargoName);
      if (cargo?.default_price != null && !price) {
        setPrice(cargo.default_price.toString());
      }
    }
  }, [cargoName, cargos.entries, price]);

  const applyResolvedTextField = useCallback(
    (
      key: AutofillTextField,
      nextValue: string,
      currentValue: string,
      setter: (value: string) => void,
    ) => {
      if (!currentValue || currentValue === lastAutoValues.current[key]) {
        setter(nextValue);
        lastAutoValues.current[key] = nextValue;
      }
    },
    [],
  );

  const runVehicleResolve = useCallback(
    (rawPlate: string, options?: { applyTare?: boolean }) => {
      const plate = formatVehiclePlate(rawPlate);
      if (!plate) {
        setDriverCandidates([]);
        setPlateSource(null);
        return;
      }

      const settings = SettingsStorage.getAppSettings();
      // Read dictionaries from storage directly so resolve sees prefs written by
      // applyVehicleLearningOnComplete in the same session (not stale useDictionary state).
      const result = resolveVehicle(plate, {
        vehicles: DictionaryStorage.getTable('vehicles'),
        drivers: DictionaryStorage.getTable('drivers'),
        vehicleDrivers: VehicleDriversStorage.getAll(),
        completedTickets: TicketStorage.getAll(),
        taraDefault: settings.tara_default,
        driverInputMode: settings.driver_input_mode,
      });

      const current = textFieldsRef.current;
      applyResolvedTextField(
        'vehicle_brand',
        result.vehicle_brand,
        current.vehicleBrand,
        setVehicleBrand,
      );
      applyResolvedTextField('driver_name', result.driver_name, current.driverName, setDriverName);
      applyResolvedTextField('cargo_name', result.cargo_name, current.cargoName, setCargoName);
      applyResolvedTextField(
        'shipper_name',
        result.shipper_name,
        current.shipperName,
        setShipperName,
      );

      setDriverCandidates(result.driver_candidates);
      setPlateSource(result.plate_source);

      const applyTare = options?.applyTare !== false;
      if (
        applyTare &&
        shouldAutofillTare({ mode: formMode, completing: isCompleting }) &&
        tareWeightRef.current == null &&
        !tareAutofillBlocked.current &&
        result.tare
      ) {
        setTareWeight(result.tare.tare_weight);
        setTareSource(result.tare.tare_source);
      }
    },
    [formMode, isCompleting, applyResolvedTextField],
  );

  useEffect(() => {
    if (!vehicleNumber || isCompleting) return;
    runVehicleResolve(vehicleNumber);
  }, [vehicleNumber, vehicles.entries, drivers.entries, isCompleting, runVehicleResolve]);

  const handleVehicleNumberChange = (value: string) => {
    tareAutofillBlocked.current = false;
    setVehicleNumber(value);
  };

  const handleDeviceChange = (id: ScaleDeviceId) => {
    setDeviceId(id);
    SettingsStorage.updateAppSettings({ scale_device_id: id });
  };

  const auditStubFields = (): Pick<
    WeighingTicket,
    'plate_source' | 'scale_role' | 'photo_entry_path' | 'photo_exit_path' | 'photo_overview_path'
  > => ({
    plate_source: plateSource,
    scale_role: null,
    photo_entry_path: null,
    photo_exit_path: null,
    photo_overview_path: null,
  });

  const handleModeChange = (mode: WeighingMode) => {
    if (isCompleting) return;
    tareAutofillBlocked.current = false;
    setFormMode(mode);
    setPhaseOverride(false);
    setOverridePhase('gross');
    setActiveField('gross');
    setCompletingTicket(null);
    setError(null);
    // Drop prior weights so single autofill / dual first-pass cannot reuse the other mode's values.
    setGrossWeight(null);
    setTareWeight(null);
    setGrossSource('manual');
    setTareSource('manual');
    setGrossRaw(null);
    setTareRaw(null);
    setGrossDatetime(null);
    setTareDatetime(null);
  };

  const captureGross = (w: number, raw: string) => {
    if (!editability.grossEditable) return;
    setGrossWeight(w);
    setGrossSource('instrument');
    setGrossRaw(raw);
    setGrossDatetime(new Date().toISOString());
  };

  const captureTare = (w: number, raw: string) => {
    if (!editability.tareEditable) return;
    tareAutofillBlocked.current = true;
    setTareWeight(w);
    setTareSource('instrument');
    setTareRaw(raw);
    setTareDatetime(new Date().toISOString());
  };

  const handleInstrumentCapture = (weight: number, raw: string) => {
    if (formMode === 'single') {
      if (activeField === 'gross') captureGross(weight, raw);
      else captureTare(weight, raw);
      return;
    }

    const slot = resolveCaptureSlot({
      phaseOverride,
      overridePhase,
      weight,
      threshold: appSettings.tara_threshold,
      editability,
    });
    if (slot == null) {
      setError('Нельзя перезаписать вес первого прохода.');
      return;
    }
    if (slot === 'gross') captureGross(weight, raw);
    else captureTare(weight, raw);
  };

  const requiredFilled =
    !!vehicleNumber && !!driverName && !!cargoName && !!shipperName && !!receiverName && !!carrierName;

  const handleSaveSingle = async () => {
    setError(null);
    setSuccess(null);
    if (!requiredFilled) {
      setError('Заполните все обязательные поля.');
      return;
    }
    const validation = validateSingleComplete({ gross: grossWeight, tare: tareWeight });
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const net = calcNetWeight(grossWeight!, tareWeight!);
    const amount = calcTotalAmount(net, parseFloat(price) || 0);
    try {
      const ticket = TicketStorage.create({
        vehicle_number: formatVehiclePlate(vehicleNumber),
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
        net_weight: net,
        total_amount: amount,
        gross_source: grossSource,
        tare_source: tareSource,
        gross_raw: grossRaw,
        tare_raw: tareRaw,
        gross_datetime: grossDatetime,
        tare_datetime: tareDatetime,
        scale_device: SCALE_DEVICES[deviceId].name,
        operator_id: null,
        operator_name: displayName,
        status: 'completed',
        completed_at: now,
        notes,
        weighing_mode: 'single',
        version: 1,
        ...auditStubFields(),
      });
      logger.info('weighing', `Создан тикет №${ticket.ticket_number}`, {
        id: ticket.id,
        mode: 'single',
        status: ticket.status,
      });
      setSaving(false);
      setLastTicket(ticket);
      setSuccess('Взвешивание завершено и сохранено.');
      onSaved(ticket);
      resetFormFields();
      setIncompleteRefresh((n) => n + 1);
    } catch (err: unknown) {
      setSaving(false);
      const message = err instanceof Error ? err.message : 'Ошибка сохранения';
      logger.error('weighing', message);
      setError(message);
    }
  };

  const handleSaveDualFirst = async () => {
    setError(null);
    setSuccess(null);
    if (!requiredFilled) {
      setError('Заполните все обязательные поля.');
      return;
    }
    const validation = validateDualFirstPass({ gross: grossWeight, tare: tareWeight });
    if (validation) {
      setError(validation);
      return;
    }

    const hasGross = grossWeight != null && grossWeight > 0;
    setSaving(true);
    try {
      const ticket = TicketStorage.create({
        vehicle_number: formatVehiclePlate(vehicleNumber),
        vehicle_brand: formatVehicleBrand(vehicleBrand),
        trailer_number: trailerNumber,
        driver_name: formatPersonName(driverName),
        cargo_name: cargoName,
        shipper_name: shipperName,
        receiver_name: receiverName,
        carrier_name: carrierName,
        price: parseFloat(price) || 0,
        vat_rate: parseFloat(vatRate) || 0,
        gross_weight: hasGross ? grossWeight : null,
        tare_weight: hasGross ? null : tareWeight,
        net_weight: null,
        total_amount: null,
        gross_source: hasGross ? grossSource : 'manual',
        tare_source: hasGross ? 'manual' : tareSource,
        gross_raw: hasGross ? grossRaw : null,
        tare_raw: hasGross ? null : tareRaw,
        gross_datetime: hasGross ? grossDatetime : null,
        tare_datetime: hasGross ? null : tareDatetime,
        scale_device: SCALE_DEVICES[deviceId].name,
        operator_id: null,
        operator_name: displayName,
        status: 'open',
        completed_at: null,
        notes,
        weighing_mode: 'dual',
        version: 1,
        ...auditStubFields(),
      });
      logger.info('weighing', `Создан тикет №${ticket.ticket_number}`, {
        id: ticket.id,
        mode: 'dual',
        status: ticket.status,
      });
      setSaving(false);
      setLastTicket(ticket);
      setSuccess('Первый проход сохранён. Тикет в незавершённых.');
      onSaved(ticket);
      resetFormFields();
      setIncompleteRefresh((n) => n + 1);
    } catch (err: unknown) {
      setSaving(false);
      const message = err instanceof Error ? err.message : 'Ошибка сохранения';
      logger.error('weighing', message);
      setError(message);
    }
  };

  const handleComplete = async () => {
    if (!completingTicket) return;
    setError(null);
    setSuccess(null);
    if (!requiredFilled) {
      setError('Заполните все обязательные поля.');
      return;
    }
    const originalState = classifyOpenWeightState(completingTicket);
    const validation = validateDualComplete({
      state: originalState,
      gross: grossWeight,
      tare: tareWeight,
    });
    if (validation) {
      setError(validation);
      return;
    }

    const now = new Date().toISOString();
    const net = calcNetWeight(grossWeight!, tareWeight!);
    const amount = calcTotalAmount(net, parseFloat(price) || 0);

    const updates: Partial<WeighingTicket> = {
      vehicle_number: formatVehiclePlate(vehicleNumber),
      vehicle_brand: formatVehicleBrand(vehicleBrand),
      trailer_number: trailerNumber,
      driver_name: formatPersonName(driverName),
      cargo_name: cargoName,
      shipper_name: shipperName,
      receiver_name: receiverName,
      carrier_name: carrierName,
      price: parseFloat(price) || 0,
      vat_rate: parseFloat(vatRate) || 0,
      notes,
      status: 'completed',
      completed_at: now,
      net_weight: net,
      total_amount: amount,
      ...auditStubFields(),
    };

    // Only write weight meta for slots that were editable (new on this step)
    if (editability.grossEditable) {
      updates.gross_weight = grossWeight;
      updates.gross_source = grossSource;
      updates.gross_raw = grossRaw;
      updates.gross_datetime = grossDatetime;
    } else {
      updates.gross_weight = completingTicket.gross_weight;
    }
    if (editability.tareEditable) {
      updates.tare_weight = tareWeight;
      updates.tare_source = tareSource;
      updates.tare_raw = tareRaw;
      updates.tare_datetime = tareDatetime;
    } else {
      updates.tare_weight = completingTicket.tare_weight;
    }

    // Update scale_device only when this step captured from instrument into an editable slot
    const instrumentOnStep =
      (editability.grossEditable && grossSource === 'instrument') ||
      (editability.tareEditable && tareSource === 'instrument');
    if (instrumentOnStep) {
      updates.scale_device = SCALE_DEVICES[deviceId].name;
    }

    setSaving(true);
    try {
      const ticket = TicketStorage.update(completingTicket.id, updates, {
        expectedVersion: completingTicket.version ?? 1,
      });
      if (!ticket) {
        setSaving(false);
        setError('Тикет изменён или удалён. Обновите список и повторите.');
        setIncompleteRefresh((n) => n + 1);
        return;
      }
      logger.info('weighing', `Завершён тикет №${ticket.ticket_number}`, {
        id: ticket.id,
        mode: ticket.weighing_mode,
        status: ticket.status,
      });
      setSaving(false);
      setLastTicket(ticket);
      setSuccess('Взвешивание завершено и сохранено.');
      onSaved(ticket);
      resetFormFields();
      exitCompletion();
      const settings = SettingsStorage.getAppSettings();
      setAppSettings(settings);
      setFormMode(settings.weighing_mode_default);
      setIncompleteRefresh((n) => n + 1);
    } catch (err: unknown) {
      setSaving(false);
      const message = err instanceof Error ? err.message : 'Ошибка сохранения';
      logger.error('weighing', message);
      setError(message);
    }
  };

  const handlePrint = () => {
    if (!lastTicket) return;
    window.dispatchEvent(new CustomEvent('print-ticket', { detail: lastTicket }));
  };

  const captureLabel =
    formMode === 'dual' && !phaseOverride && suggestedPhase
      ? suggestedPhase === 'gross'
        ? 'Зафиксировать брутто'
        : 'Зафиксировать тару'
      : highlightPhase === 'gross'
        ? 'Зафиксировать брутто'
        : 'Зафиксировать тару';

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition';
  const labelClass = 'block text-xs font-medium text-slate-600 mb-1';
  const showIncompletePanel = formMode === 'dual' || isCompleting;

  const driverInputMode = SettingsStorage.getAppSettings().driver_input_mode;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] min-w-0">
      <div className="space-y-5 min-w-0">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <ClipboardList size={20} className="text-blue-600" />
              <h2 className="text-base font-semibold text-slate-800">Данные взвешивания</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                <button
                  type="button"
                  disabled={isCompleting}
                  onClick={() => handleModeChange('single')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    formMode === 'single' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                  } disabled:opacity-60`}
                >
                  Одиночное
                </button>
                <button
                  type="button"
                  disabled={isCompleting}
                  onClick={() => handleModeChange('dual')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    formMode === 'dual' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                  } disabled:opacity-60`}
                >
                  Двойное
                </button>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                Весовщик: {displayName}
              </span>
            </div>
          </div>

          {isCompleting && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Дозавершение талона №{completingTicket.ticket_number ?? '—'} ({completingTicket.vehicle_number})
            </div>
          )}

          {showIntervalBanner && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Интервал между проходами превышает допустимый ({appSettings.max_time_between} ч). Сохранение не блокируется.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Номер автомобиля *</label>
              <input list="vehicles-list" value={vehicleNumber} onChange={(e) => handleVehicleNumberChange(e.target.value)} placeholder="А123ВС77" className={inputClass} />
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
              <label className={labelClass}>
                ФИО водителя *
                {driverInputMode === 'vehicle' && (
                  <span className="ml-1 font-normal text-slate-400">По истории ТС</span>
                )}
              </label>
              <input
                list={driverInputMode === 'free' ? undefined : 'drivers-list'}
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Иванов И.И."
                className={inputClass}
              />
              {driverInputMode !== 'free' && (
                <datalist id="drivers-list">
                  {(driverInputMode === 'vehicle'
                    ? driverCandidates
                    : drivers.entries.map((d) => d.name)
                  ).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              )}
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

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <FileText size={20} className="text-blue-600" />
              <h2 className="text-base font-semibold text-slate-800">Показания весов</h2>
            </div>
            {formMode === 'dual' && (
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                <button
                  type="button"
                  disabled={!editability.grossEditable}
                  onClick={() => {
                    if (!editability.grossEditable) return;
                    setPhaseOverride(true);
                    setOverridePhase('gross');
                    setActiveField('gross');
                  }}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    highlightPhase === 'gross' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Брутто
                </button>
                <button
                  type="button"
                  disabled={!editability.tareEditable}
                  onClick={() => {
                    if (!editability.tareEditable) return;
                    setPhaseOverride(true);
                    setOverridePhase('tare');
                    setActiveField('tare');
                  }}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    highlightPhase === 'tare' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Тара
                </button>
              </div>
            )}
          </div>

          {formMode === 'dual' && !phaseOverride && suggestedPhase && (
            <p className="mb-3 text-xs text-slate-500">
              Подсказка по порогу: {suggestedPhase === 'tare' ? 'тара' : 'брутто'}
              {phaseOverride ? '' : ' (можно переопределить кнопками Брутто/Тара)'}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className={`rounded-xl border-2 p-4 transition ${highlightPhase === 'gross' ? 'border-blue-500 bg-blue-50/30' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600">БРУТТО</span>
                <WeightSourceBadge weight={grossWeight} source={grossSource} />
              </div>
              <input
                type="number"
                value={grossWeight ?? ''}
                disabled={!editability.grossEditable}
                onChange={(e) => {
                  setGrossWeight(parseWeightInput(e.target.value));
                  setGrossSource('manual');
                  setGrossRaw(null);
                  setGrossDatetime(new Date().toISOString());
                }}
                onFocus={() => {
                  if (editability.grossEditable) setActiveField('gross');
                }}
                placeholder="0"
                className="w-full bg-transparent text-2xl font-bold tabular-nums text-slate-800 outline-none disabled:opacity-60"
              />
              <span className="text-xs text-slate-400">кг</span>
            </div>
            <div className={`rounded-xl border-2 p-4 transition ${highlightPhase === 'tare' ? 'border-blue-500 bg-blue-50/30' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600">ТАРА</span>
                <WeightSourceBadge weight={tareWeight} source={tareSource} />
              </div>
              <input
                type="number"
                value={tareWeight ?? ''}
                disabled={!editability.tareEditable}
                onChange={(e) => {
                  tareAutofillBlocked.current = true;
                  setTareWeight(parseWeightInput(e.target.value));
                  setTareSource('manual');
                  setTareRaw(null);
                  setTareDatetime(new Date().toISOString());
                }}
                onFocus={() => {
                  if (editability.tareEditable) setActiveField('tare');
                }}
                placeholder="0"
                className="w-full bg-transparent text-2xl font-bold tabular-nums text-slate-800 outline-none disabled:opacity-60"
              />
              <span className="text-xs text-slate-400">кг</span>
            </div>
            <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600">НЕТТО</span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-slate-800">{netWeightValue != null ? netWeightValue.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—'}</div>
              <span className="text-xs text-slate-400">кг</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-4 text-white">
            <div>
              <div className="text-xs font-medium text-blue-100">Итого к оплате</div>
              <div className="text-2xl font-bold tabular-nums">{totalAmountValue != null ? `${totalAmountValue.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽` : '—'}</div>
            </div>
            <div className="text-right text-xs text-blue-100">
              <div>Нетто: {netWeightValue != null ? `${(netWeightValue / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} т` : '—'}</div>
              <div>Цена: {price ? `${parseFloat(price).toLocaleString('ru-RU')} ₽/т` : '—'}</div>
            </div>
          </div>
        </div>

        {showIncompletePanel && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Незавершённые</h3>
            {incompleteTickets.length === 0 ? (
              <p className="text-sm text-slate-500">Нет незавершённых рейсов двойного режима.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3 font-medium">Талон</th>
                      <th className="py-2 pr-3 font-medium">Госномер</th>
                      <th className="py-2 pr-3 font-medium">Первый вес</th>
                      <th className="py-2 pr-3 font-medium">Есть</th>
                      <th className="py-2 pr-3 font-medium">Оператор</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {incompleteTickets.map((t) => (
                      <tr key={t.id} className="border-b border-slate-50">
                        <td className="py-2 pr-3 tabular-nums">№{t.ticket_number ?? '—'}</td>
                        <td className="py-2 pr-3">{t.vehicle_number}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                          {new Date(firstWeightDatetime(t)).toLocaleString('ru-RU')}
                        </td>
                        <td className="py-2 pr-3">{weightPresentLabel(t)}</td>
                        <td className="py-2 pr-3">{t.operator_name}</td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => loadTicketForCompletion(t.id)}
                            className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Выбрать
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {unstableWarning && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <AlertCircle size={18} className="mt-0.5 shrink-0" /> {unstableWarning}
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> {success}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {isCompleting ? (
            <button
              onClick={handleComplete}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Save size={18} /> {saving ? 'Сохранение...' : 'Завершить'}
            </button>
          ) : formMode === 'single' ? (
            <button
              onClick={handleSaveSingle}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Save size={18} /> {saving ? 'Сохранение...' : 'Сохранить и завершить'}
            </button>
          ) : (
            <button
              onClick={handleSaveDualFirst}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Save size={18} /> {saving ? 'Сохранение...' : 'Сохранить первый проход'}
            </button>
          )}
          {lastTicket && lastTicket.status === 'completed' && (
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
        <ScalePanel
          onCapture={handleInstrumentCapture}
          label={captureLabel}
          capturedWeight={highlightPhase === 'gross' ? grossWeight : tareWeight}
          deviceId={deviceId}
          onDeviceChange={handleDeviceChange}
          stableMode={appSettings.stable_mode}
          onReadingChange={setLiveScaleWeight}
          onUnstableCapture={() => {
            setUnstableWarning('Зафиксирован нестабильный вес.');
            window.setTimeout(() => setUnstableWarning(null), 4000);
          }}
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Порядок работы</h3>
          <ol className="space-y-2 text-sm text-slate-600">
            {formMode === 'single' ? (
              <>
                <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">1</span> Заполните данные об автомобиле и грузе</li>
                <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">2</span> Зафиксируйте брутто; тара подставится из справочника при наличии</li>
                <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">3</span> Нажмите «Сохранить и завершить»</li>
              </>
            ) : (
              <>
                <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">1</span> Заполните реквизиты и зафиксируйте один вес первого прохода</li>
                <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">2</span> Сохраните первый проход</li>
                <li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">3</span> Выберите рейс в «Незавершённые» и завершите вторым весом</li>
              </>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
