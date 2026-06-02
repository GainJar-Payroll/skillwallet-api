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
