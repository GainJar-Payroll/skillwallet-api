/**
 * Standardized response envelope.
 *
 * Success: { payload: T, meta: { requestId, timestamp } }
 * Error:   { error: { code, message, fields?, type? }, meta: { requestId, timestamp } }
 *
 * Exactly one of `payload` or `error` is present per response.
 * `meta` is always present so support can correlate by requestId.
 */
import { ErrorCode } from '../errors/error-codes';

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

export interface SuccessEnvelope<T> {
  payload: T;
  meta: ResponseMeta;
}

export interface ErrorFieldDetail {
  field: string;
  reason: string;
  code?: string;
}

export interface ErrorBody {
  code: ErrorCode | 'INTERNAL_ERROR' | 'UNAUTHORIZED';
  message: string;
  type?: string;
  fields?: ErrorFieldDetail[];
}

export interface ErrorEnvelope {
  error: ErrorBody;
  meta: ResponseMeta;
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
