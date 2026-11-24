// SQL Server notation `host\instance` and `DOMAIN\user`, split into the connection's fields
import { test } from 'bun:test'
import { splitMssqlBackslashes } from '../core/mssql-address.ts'
import { assertEquals } from './assert.ts'

test('splits host\\instance into host and named instance', () => {
  assertEquals(splitMssqlBackslashes({ host: '10.0.0.5\\sqlerp', instanceName: 'old' }), {
    host: '10.0.0.5',
    instanceName: 'sqlerp',
  })
})

test('splits DOMAIN\\user into domain and user and switches to the Windows login', () => {
  assertEquals(splitMssqlBackslashes({ user: 'CORP\\jdoe', auth: 'password' }), {
    user: 'jdoe',
    auth: 'windows',
    domain: 'CORP',
  })
  assertEquals(splitMssqlBackslashes({ user: 'CORP\\jdoe' }), { user: 'jdoe', auth: 'windows', domain: 'CORP' })
})

test('leaves other values and Entra logins unchanged', () => {
  for (const body of [
    { host: 'db.example.com', user: 'sa' },
    { host: '\\sqlerp', user: 'CORP\\' },
    { host: 'a\\b\\c' },
    { user: 'CORP\\jdoe', auth: 'entra-interactive' },
  ]) {
    assertEquals(splitMssqlBackslashes(body), body)
  }
})
