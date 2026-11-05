// The assertions of @std/assert that the tests use, on top of bun:test's `expect`.
import { expect } from 'bun:test'

export function assert(expr: unknown, msg = 'expected a truthy value'): asserts expr {
  if (!expr) throw new Error(msg)
}

export const assertEquals = (actual: unknown, expected: unknown, msg?: string) => expect(actual, msg).toEqual(expected)
export const assertMatch = (actual: string, expected: RegExp) => expect(actual).toMatch(expected)
export const assertStringIncludes = (actual: string, expected: string) => expect(actual).toContain(expected)

/** Resolves with the error `fn` rejects with, checked against the class and the message part if given. */
export async function assertRejects<E extends Error = Error>(
  fn: () => PromiseLike<unknown>,
  ErrorClass?: abstract new (...args: never[]) => E,
  msgIncludes?: string,
): Promise<E> {
  try {
    await fn()
  } catch (e) {
    if (ErrorClass) expect(e).toBeInstanceOf(ErrorClass)
    if (msgIncludes) expect((e as Error).message).toContain(msgIncludes)
    return e as E
  }
  throw new Error('expected the promise to reject')
}
