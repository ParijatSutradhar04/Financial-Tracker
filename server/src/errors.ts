import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

export class HttpError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details)
export const notFound = (message: string) => new HttpError(404, message)

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T>(fn: (req: Request, res: Response) => Promise<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next)
  }
}

const PG_CHECK_VIOLATION = '23514'
const PG_FOREIGN_KEY_VIOLATION = '23503'
const PG_RAISE_EXCEPTION = 'P0001'

function isPgError(error: unknown): error is { code: string; message: string } {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details })
    return
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request body',
      details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    })
    return
  }

  if (isPgError(error)) {
    // The schema enforces `amount > 0`, the credit/debit enum, valid account
    // references, and transaction immutability at the database level. All of
    // those mean the caller sent something invalid, not that the server broke.
    if (
      error.code === PG_CHECK_VIOLATION ||
      error.code === PG_FOREIGN_KEY_VIOLATION ||
      error.code === PG_RAISE_EXCEPTION
    ) {
      res.status(400).json({ error: error.message })
      return
    }
  }

  console.error('Unhandled error', error)
  res.status(500).json({ error: 'Internal server error' })
}
