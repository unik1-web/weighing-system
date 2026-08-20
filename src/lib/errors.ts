export function getErrorMessage(error: unknown, fallback = 'Произошла ошибка'): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    try {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
      if (serialized && serialized !== '{}') {
        return serialized;
      }
    } catch {
      // Ignore serialization errors and fall back to the default message.
    }
  }

  return fallback;
}
