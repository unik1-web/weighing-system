import type { Scale } from './storage';
import { scaleConnect, scaleDisconnect, scaleRead } from './api';
import { SITE_RUNTIME_CHANGED_EVENT } from './site';
import { scaleConnection } from './scales';
import { logger, type ScaleRuntimeContext } from './logger';

export type ScaleRuntimeMode = 'web_serial' | 'backend_api';
export type ScaleRuntimeConnectStatus = 'connected' | 'manual_only' | 'error';
export type ScaleRuntimeStatus = 'connected' | 'reading' | 'manual_only' | 'error' | 'disconnected';
export type RuntimeErrorCode =
  | 'invalid_connection_config'
  | 'unsupported_transport'
  | 'transport_unavailable'
  | 'read_timeout'
  | 'stale_session'
  | 'backend_unavailable';

export interface RuntimeReading {
  value: number;
  stable: boolean;
  raw: string;
  captured_at: string;
}

export interface RuntimeState {
  status: ScaleRuntimeStatus;
  reading: RuntimeReading | null;
  error: string | null;
  mode: ScaleRuntimeMode | null;
}

interface RuntimeErrorInfo {
  code: RuntimeErrorCode;
  message: string;
}

interface ApiErrorLike {
  code?: string;
  message?: string;
}

function hasWebSerialConfig(scale: Scale): boolean {
  return scale.connection.transport === 'web_serial' && !!scale.connection.device_id;
}

function hasBackendSerialConfig(scale: Scale): boolean {
  return scale.connection.transport === 'serial_backend';
}

function getTimerApi() {
  return typeof window === 'undefined' ? globalThis : window;
}

export class ScaleRuntimeClient {
  private state: RuntimeState = {
    status: 'disconnected',
    reading: null,
    error: null,
    mode: null,
  };

  private sessionId: string | null = null;
  private readonly runtimeChangedHandler: () => void;
  private activeScale: Scale | null = null;
  private retryConsumed = false;

  private runtimeContext(extra?: Partial<ScaleRuntimeContext>): ScaleRuntimeContext {
    return {
      site_id: this.activeScale?.site_id ?? null,
      scale_id: this.activeScale?.id ?? null,
      scale_role: this.activeScale?.role ?? null,
      adapter_id: this.activeScale?.adapter_id ?? null,
      transport: this.state.mode ?? this.activeScale?.connection.transport ?? null,
      session_id: this.sessionId,
      code: null,
      phase: null,
      ...extra,
    };
  }

  constructor() {
    this.runtimeChangedHandler = () => {
      void this.handleSiteRuntimeChanged();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener(SITE_RUNTIME_CHANGED_EVENT, this.runtimeChangedHandler);
    }
  }

  async connect(
    activeScale: Scale,
  ): Promise<{ mode: 'web_serial' | 'backend_api'; status: ScaleRuntimeConnectStatus }> {
    this.activeScale = activeScale;
    this.state.error = null;
    this.state.reading = null;
    this.sessionId = null;
    this.retryConsumed = false;
    logger.scaleRuntime.info('Попытка подключения runtime', this.runtimeContext({ phase: 'connect_attempt' }));

    if (hasWebSerialConfig(activeScale)) {
      return this.connectWebSerial(activeScale);
    }

    if (hasBackendSerialConfig(activeScale)) {
      return this.connectBackend(activeScale);
    }

    this.state.mode = activeScale.connection.transport === 'serial_backend' ? 'backend_api' : 'web_serial';
    this.setManualOnly({
      code: 'invalid_connection_config',
      message: 'Неполная конфигурация активного комплекта. Доступен ручной ввод.',
    });
    return { mode: this.state.mode, status: 'manual_only' };
  }

  async read(timeoutMs: number): Promise<RuntimeReading | null> {
    if (this.state.status === 'manual_only' || this.state.status === 'disconnected') {
      return null;
    }

    if (this.state.mode === 'web_serial') {
      return this.readWithSingleRetry(async () => this.readWebSerial(timeoutMs));
    }

    if (this.state.mode === 'backend_api' && this.sessionId) {
      return this.readWithSingleRetry(async () => this.readBackend(timeoutMs));
    }

    this.setManualOnly({
      code: 'stale_session',
      message: 'Сессия чтения устарела. Повторите подключение вручную.',
    });
    return null;
  }

  getStatus(): { status: ScaleRuntimeStatus; reading: RuntimeReading | null; error: string | null } {
    return {
      status: this.state.status,
      reading: this.state.reading,
      error: this.state.error,
    };
  }

  private async handleSiteRuntimeChanged(): Promise<void> {
    await this.disconnect();
  }

  async disconnect(): Promise<void> {
    if (this.state.mode === 'backend_api' && this.sessionId) {
      try {
        await scaleDisconnect(this.sessionId);
      } catch {
        // stale/disconnect race should not block UI cleanup
      }
    }
    if (this.state.mode === 'web_serial' && scaleConnection.isConnected()) {
      try {
        await scaleConnection.disconnect();
      } catch {
        // transport close failures should not block UI cleanup
      }
    }
    this.sessionId = null;
    this.activeScale = null;
    this.retryConsumed = false;
    this.state = {
      status: 'disconnected',
      reading: null,
      error: null,
      mode: null,
    };
  }

  private async connectWebSerial(
    activeScale: Scale,
  ): Promise<{ mode: 'web_serial'; status: ScaleRuntimeConnectStatus }> {
    this.state.mode = 'web_serial';
    const deviceId = activeScale.connection.device_id;
    if (!deviceId) {
      this.setManualOnly({
        code: 'invalid_connection_config',
        message: 'Не выбран профиль терминала для Web Serial.',
      });
      return { mode: 'web_serial', status: 'manual_only' };
    }
    try {
      await scaleConnection.connect(deviceId);
      this.state.status = 'connected';
      logger.scaleRuntime.info('Подключение web_serial успешно', this.runtimeContext({ phase: 'connect_success' }));
      return { mode: 'web_serial', status: 'connected' };
    } catch (error: unknown) {
      const normalized = this.normalizeRuntimeError(error, 'web_serial');
      this.setManualOnly(normalized);
      return { mode: 'web_serial', status: 'manual_only' };
    }
  }

  private async connectBackend(
    activeScale: Scale,
  ): Promise<{ mode: 'backend_api'; status: ScaleRuntimeConnectStatus }> {
    this.state.mode = 'backend_api';
    try {
      const response = await scaleConnect({
        expected_site_id: activeScale.site_id,
        expected_scale_id: activeScale.id,
        expected_scale_role: activeScale.role,
      });
      this.sessionId = response.session_id;
      this.state.status = response.status;
      this.state.reading = response.reading
        ? {
            value: response.reading.value,
            stable: response.reading.stable,
            raw: response.reading.raw ?? '',
            captured_at: response.reading.captured_at,
          }
        : null;
      logger.scaleRuntime.info('Подключение backend_api успешно', this.runtimeContext({ phase: 'connect_success' }));
      return { mode: 'backend_api', status: 'connected' };
    } catch (error: unknown) {
      const normalized = this.normalizeRuntimeError(error, 'backend_api');
      this.setManualOnly(normalized);
      return { mode: 'backend_api', status: 'manual_only' };
    }
  }

  private async readBackend(timeoutMs: number): Promise<RuntimeReading> {
    if (!this.sessionId) {
      throw this.createRuntimeError({
        code: 'stale_session',
        message: 'Сессия чтения не найдена. Повторите подключение.',
      });
    }
    const response = await scaleRead({
      session_id: this.sessionId,
      timeout_ms: timeoutMs,
    });
    const reading = {
      value: response.reading.value,
      stable: response.reading.stable,
      raw: response.reading.raw ?? '',
      captured_at: response.reading.captured_at,
    };
    this.state.reading = reading;
    this.state.status = response.status;
    this.state.error = null;
    logger.scaleRuntime.info('Успешное чтение backend_api', this.runtimeContext({ phase: 'read_success' }), {
      value: reading.value,
      stable: reading.stable,
    });
    return reading;
  }

  private async readWebSerial(timeoutMs: number): Promise<RuntimeReading> {
    if (!scaleConnection.isConnected()) {
      throw this.createRuntimeError({
        code: 'transport_unavailable',
        message: 'Нет активного подключения к Web Serial.',
      });
    }
    return new Promise<RuntimeReading>((resolve, reject) => {
      const timerApi = getTimerApi();
      let unsubscribe: () => void = () => undefined;
      const timer = timerApi.setTimeout(() => {
        unsubscribe();
        reject(
          this.createRuntimeError({
            code: 'read_timeout',
            message: 'Не удалось получить показание с терминала за отведённое время.',
          }),
        );
      }, Math.max(1, timeoutMs));
      unsubscribe = scaleConnection.onReading((reading) => {
        timerApi.clearTimeout(timer);
        unsubscribe();
        const runtimeReading: RuntimeReading = {
          value: reading.weight,
          stable: reading.stable,
          raw: reading.raw,
          captured_at: new Date().toISOString(),
        };
        this.state.reading = runtimeReading;
        this.state.status = 'reading';
        this.state.error = null;
        logger.scaleRuntime.info('Успешное чтение web_serial', this.runtimeContext({ phase: 'read_success' }), {
          value: runtimeReading.value,
          stable: runtimeReading.stable,
        });
        resolve(runtimeReading);
      });
    });
  }

  private async readWithSingleRetry(readFn: () => Promise<RuntimeReading>): Promise<RuntimeReading | null> {
    try {
      return await readFn();
    } catch (error: unknown) {
      const normalized = this.normalizeRuntimeError(error, this.state.mode ?? 'backend_api');
      if (!this.retryConsumed && this.canRetryOnce(normalized.code) && this.activeScale) {
        this.retryConsumed = true;
        logger.scaleRuntime.warn(
          'Неожиданный разрыв runtime, запускаем единственный auto-retry',
          this.runtimeContext({ phase: 'retry_start', code: normalized.code }),
        );
        await this.delay(1000);
        const reconnect = await this.connect(this.activeScale);
        if (reconnect.status === 'connected') {
          try {
            return await readFn();
          } catch (retryError: unknown) {
            const retryNormalized = this.normalizeRuntimeError(retryError, this.state.mode ?? 'backend_api');
            logger.scaleRuntime.error(
              'Окончательный отказ после auto-retry',
              this.runtimeContext({ phase: 'retry_failed', code: retryNormalized.code }),
            );
            this.setManualOnly(retryNormalized);
            return null;
          }
        }
      }
      logger.scaleRuntime.error(
        'Чтение завершилось ошибкой, переход в manual_only',
        this.runtimeContext({ phase: 'read_failed', code: normalized.code }),
      );
      this.setManualOnly(normalized);
      return null;
    }
  }

  private canRetryOnce(code: RuntimeErrorCode): boolean {
    return code === 'transport_unavailable' || code === 'backend_unavailable' || code === 'stale_session';
  }

  private setManualOnly(error: RuntimeErrorInfo): void {
    this.state.status = 'manual_only';
    this.state.error = `${error.code}: ${error.message}`;
    logger.scaleRuntime.warn(
      'Runtime переведён в manual_only',
      this.runtimeContext({ phase: 'manual_only', code: error.code }),
      { message: error.message },
    );
  }

  private normalizeRuntimeError(error: unknown, mode: ScaleRuntimeMode): RuntimeErrorInfo {
    const fallbackMessage = error instanceof Error ? error.message : String(error);
    if (fallbackMessage.includes(':')) {
      const [rawCode, ...messageParts] = fallbackMessage.split(':');
      const code = rawCode.trim() as RuntimeErrorCode;
      const message = messageParts.join(':').trim() || fallbackMessage;
      if (this.isKnownRuntimeErrorCode(code)) {
        return { code, message };
      }
    }
    const apiError = error as ApiErrorLike;
    if (apiError && typeof apiError.code === 'string' && this.isKnownRuntimeErrorCode(apiError.code)) {
      return {
        code: apiError.code,
        message: apiError.message ?? fallbackMessage,
      };
    }
    if (mode === 'backend_api') {
      return {
        code: 'backend_unavailable',
        message: fallbackMessage || 'Backend API недоступен.',
      };
    }
    return {
      code: 'transport_unavailable',
      message: fallbackMessage || 'Transport недоступен.',
    };
  }

  private isKnownRuntimeErrorCode(value: string): value is RuntimeErrorCode {
    return (
      value === 'invalid_connection_config' ||
      value === 'unsupported_transport' ||
      value === 'transport_unavailable' ||
      value === 'read_timeout' ||
      value === 'stale_session' ||
      value === 'backend_unavailable'
    );
  }

  private createRuntimeError(error: RuntimeErrorInfo): Error {
    return new Error(`${error.code}: ${error.message}`);
  }

  private async delay(ms: number): Promise<void> {
    const timerApi = getTimerApi();
    await new Promise((resolve) => timerApi.setTimeout(resolve, ms));
  }
}
