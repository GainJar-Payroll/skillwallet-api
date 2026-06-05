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
  [ErrorCode.TOKEN_NOT_ALLOWED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.SELF_SWAP_REJECTED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.ADAPTER_NOT_ALLOWED_ADJUSTMENT]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.OVER_ATTENUATION]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.ATTENUATION_MISMATCH]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.WALLET_PERMISSION_RESPONSE_REQUIRED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.INVALID_WALLET_PERMISSION_RESPONSE]: HttpStatus.BAD_REQUEST,
  [ErrorCode.CHAIN_UNSUPPORTED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BAD_CHAIN_ID]: HttpStatus.BAD_REQUEST,
  [ErrorCode.TOKEN_NOT_IN_REGISTRY]: HttpStatus.BAD_REQUEST,
  [ErrorCode.ROUTER_MISMATCH]: HttpStatus.BAD_REQUEST,
  [ErrorCode.CONFIG_INVALID]: HttpStatus.BAD_REQUEST,
  [ErrorCode.AMOUNT_INVALID]: HttpStatus.BAD_REQUEST,
  [ErrorCode.NO_ACTIVE_GRANT]: HttpStatus.PRECONDITION_FAILED,
  [ErrorCode.BUNDLE_REJECTED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.RELAYER_UNSUPPORTED_CHAIN]: HttpStatus.BAD_REQUEST,
  [ErrorCode.RELAYER_UNSUPPORTED_TOKEN]: HttpStatus.BAD_REQUEST,
  [ErrorCode.RELAYER_TRANSPORT_ERROR]: HttpStatus.BAD_GATEWAY,
  [ErrorCode.RELAYER_BAD_RESPONSE]: HttpStatus.BAD_GATEWAY,
  [ErrorCode.RELAYER_RPC_ERROR]: HttpStatus.BAD_GATEWAY,
  [ErrorCode.METHOD_NOT_WHITELISTED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.INSTALLATION_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CHAIN_MISMATCH]: HttpStatus.BAD_REQUEST,
  [ErrorCode.DELEGATOR_MISMATCH]: HttpStatus.FORBIDDEN,
  [ErrorCode.DELEGATION_DELEGATOR_MISMATCH]: HttpStatus.BAD_REQUEST,
  [ErrorCode.DELEGATION_DELEGATE_MISMATCH]: HttpStatus.BAD_REQUEST,
  [ErrorCode.POLICY_RULE_UNKNOWN]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.RUNNER_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
};

export class AppError extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown);
  constructor(code: ErrorCode, status: HttpStatus, message: string, details?: unknown);
  constructor(
    code: ErrorCode,
    statusOrMessage: HttpStatus | string,
    messageOrDetails?: string | unknown,
    details?: unknown,
  ) {
    const status =
      typeof statusOrMessage === 'number' ? statusOrMessage : (statusByCode[code] ?? 500);
    const message =
      typeof statusOrMessage === 'number'
        ? (messageOrDetails as string)
        : (statusOrMessage as string);
    const resolvedDetails = typeof statusOrMessage === 'number' ? details : messageOrDetails;
    super({ code, message, details: resolvedDetails }, status);
    this.code = code;
    this.details = resolvedDetails;
  }

  static notConfigured(what: string, why: string): AppError {
    return new AppError(ErrorCode.NOT_CONFIGURED, `${what} not configured: ${why}`);
  }

  static notFound(what: string): AppError {
    return new AppError(ErrorCode.NOT_FOUND, `${what} not found`);
  }
}
