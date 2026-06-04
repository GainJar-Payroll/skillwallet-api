import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

const statusByCode: Record<ErrorCode, HttpStatus> = {
  [ErrorCode.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.NOT_CONFIGURED]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.ADAPTER_NOT_IMPLEMENTED]: HttpStatus.NOT_IMPLEMENTED,
  [ErrorCode.ACTION_BUILD_NOT_CONFIGURED]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.NOT_IMPLEMENTED]: HttpStatus.NOT_IMPLEMENTED,
  [ErrorCode.POLICY_BLOCKED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.RELAYER_ERROR]: HttpStatus.BAD_GATEWAY,
  [ErrorCode.INVALID_STATE]: HttpStatus.CONFLICT,
  [ErrorCode.ONESHOT_METHOD_NOT_IMPLEMENTED]: HttpStatus.NOT_IMPLEMENTED,
  [ErrorCode.ONESHOT_RPC_ERROR]: HttpStatus.BAD_GATEWAY,
  [ErrorCode.ONESHOT_CAPABILITY_UNSUPPORTED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.ONESHOT_PAYMENT_TOKEN_UNSUPPORTED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.MISSING_ONESHOT_CONTEXT]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.MISSING_PERMISSION_CONTEXT]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.EXPIRED_ONESHOT_CONTEXT]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.INVALID_ONESHOT_BUNDLE]: HttpStatus.BAD_REQUEST,
  [ErrorCode.SIGNATURE_REFRESH_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.WEBHOOK_VERIFICATION_NOT_CONFIGURED]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.WEBHOOK_SIGNATURE_INVALID]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.RELAY_STATUS_UNKNOWN]: HttpStatus.BAD_GATEWAY,
  [ErrorCode.ONESHOT_INSUFFICIENT_PAYMENT]: HttpStatus.PAYMENT_REQUIRED,
  [ErrorCode.ONESHOT_SIMULATION_FAILED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.ONESHOT_INVALID_AUTHORIZATION_LIST]: HttpStatus.BAD_REQUEST,
};

export class AppError extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super({ code, message, details }, statusByCode[code]);
    this.code = code;
    this.details = details;
  }
}
