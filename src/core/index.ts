/**
 * Shared core: platform-neutral building blocks used by every module.
 * Import from "@/core" only. UI pieces live in "@/core/ui".
 */
export * from './errors';
export * from './validation';
export * from './limits';
export * from './logger';
export { redactFields, scrubString, isSensitiveField, type LogFields, type LogValue } from './redact';
export * from './stats';
export * from './base64';
export * from './escape';
export * from './color';
export * from './strings';
export * from './ids';
export * from './document';
export * from './results';
export * from './platform';
