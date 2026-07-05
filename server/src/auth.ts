import type { FastifyRequest } from 'fastify';
import type { Account, Store } from './db.ts';
import { ApiError } from './http.ts';

/** Extract and validate the Bearer device token, returning its account. Throws 401 otherwise. */
export function requireAccount(req: FastifyRequest, store: Store): { token: string; account: Account } {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';
  if (!token) throw new ApiError(401, '缺少设备令牌');
  const account = store.getAccount(token);
  if (!account) throw new ApiError(401, '设备令牌无效');
  return { token, account };
}
