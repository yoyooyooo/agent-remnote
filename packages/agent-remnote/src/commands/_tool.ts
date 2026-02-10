import { CliError, isCliError, type CliErrorCode, type CliExitCode } from '../services/Errors.js';

export function cliErrorFromUnknown(
  error: unknown,
  params?: { readonly code?: CliErrorCode; readonly exitCode?: CliExitCode; readonly details?: unknown },
): CliError {
  if (isCliError(error)) return error;
  const rawMessage = String((error as any)?.message || error || 'Unknown error');

  if (rawMessage.startsWith('Invalid arguments')) {
    return new CliError({
      code: 'INVALID_ARGS',
      message: rawMessage,
      exitCode: 2,
      details: params?.details ?? { error: rawMessage },
    });
  }

  if (rawMessage.startsWith('参数错误')) {
    const suffix = rawMessage.replace(/^参数错误[:：]?\s*/u, '');
    const message = suffix ? `Invalid arguments: ${suffix}` : 'Invalid arguments';
    return new CliError({
      code: 'INVALID_ARGS',
      message,
      exitCode: 2,
      details: params?.details ?? { error: message },
    });
  }
  const message = rawMessage === '未知错误' ? 'Unknown error' : rawMessage;
  return new CliError({
    code: params?.code ?? 'INTERNAL',
    message,
    exitCode: params?.exitCode ?? 1,
    details: params?.details ?? { error: message },
  });
}
