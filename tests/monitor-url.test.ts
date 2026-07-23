import { describe, expect, it } from 'vitest'

import {
  isForbiddenHostname,
  isPrivateIp,
  validateMonitorUrl,
} from '@/lib/db/monitor-url'

// Unit coverage for the two halves of monitor URL safety: the syntactic
// validation the data layer runs on save, and the address space screening
// the cron path runs on every check (the SSRF guard's decision table).

describe('validateMonitorUrl', () => {
  it('accepts plain http and https URLs and normalizes them', () => {
    expect(validateMonitorUrl('https://example.com')).toEqual({
      ok: true,
      url: 'https://example.com/',
    })
    expect(validateMonitorUrl('  http://example.com/path?x=1  ')).toEqual({
      ok: true,
      url: 'http://example.com/path?x=1',
    })
  })

  it('rejects every non http scheme', () => {
    for (const raw of [
      'ftp://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'gopher://example.com',
      'ws://example.com',
    ]) {
      expect(validateMonitorUrl(raw).ok, raw).toBe(false)
    }
  })

  it('rejects empty input, garbage, and embedded credentials', () => {
    expect(validateMonitorUrl('').ok).toBe(false)
    expect(validateMonitorUrl('   ').ok).toBe(false)
    expect(validateMonitorUrl('not a url').ok).toBe(false)
    expect(validateMonitorUrl('https://user:pass@example.com').ok).toBe(false)
    expect(validateMonitorUrl(`https://example.com/${'a'.repeat(2050)}`).ok).toBe(false)
  })
})

describe('isForbiddenHostname', () => {
  it('blocks localhost in every spelling', () => {
    expect(isForbiddenHostname('localhost')).toBe(true)
    expect(isForbiddenHostname('LOCALHOST')).toBe(true)
    expect(isForbiddenHostname('localhost.')).toBe(true)
    expect(isForbiddenHostname('foo.localhost')).toBe(true)
  })

  it('allows ordinary hostnames', () => {
    expect(isForbiddenHostname('example.com')).toBe(false)
    expect(isForbiddenHostname('localhost.example.com')).toBe(false)
  })
})

describe('isPrivateIp', () => {
  it.each([
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.4.4',
    '192.168.1.1',
    '127.0.0.1',
    '127.8.8.8',
    '169.254.169.254', // cloud metadata endpoint, the classic SSRF target
    '100.64.0.1',
    '100.127.255.254',
    '0.0.0.0',
  ])('blocks private and internal IPv4 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1', // just below 172.16/12
    '172.32.0.1', // just above 172.16/12
    '100.63.0.1', // just below CGNAT
    '100.128.0.1', // just above CGNAT
    '192.169.0.1',
    '11.0.0.1',
  ])('allows public IPv4 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false)
  })

  it.each([
    '::1',
    '::',
    'fe80::1',
    'febf::1', // still inside fe80::/10
    'fc00::1',
    'fd12:3456:789a::1',
    '::ffff:10.0.0.1', // IPv4 mapped private
    '::ffff:192.168.0.1',
    'fec0::1', // deprecated site local, still internal space
  ])('blocks private and internal IPv6 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8', // IPv4 mapped public
  ])('allows public IPv6 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false)
  })
})
