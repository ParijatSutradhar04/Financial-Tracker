import { Router } from 'express'
import { pool } from '../db.ts'
import { asyncHandler } from '../errors.ts'
import { nextPayday } from '../services/payday.ts'

export const paydayRouter = Router()

paydayRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await nextPayday(pool))
  }),
)
