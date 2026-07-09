import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsStringLiteral, isValidTokenShape, StubPaymentProvider } from '../src/payments.ts';

test('jsStringLiteral neutralizes a </script> breakout', () => {
  const out = jsStringLiteral('a</script><script>alert(1)</script>');
  assert.ok(!out.includes('</script>'), 'must not contain a raw closing script tag');
  assert.ok(out.includes('\\u003c'), '< is escaped');
  assert.equal(JSON.parse(out), 'a</script><script>alert(1)</script>');
});

test('jsStringLiteral escapes line/paragraph separators', () => {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const input = `a${LS}b${PS}c`;
  const out = jsStringLiteral(input);
  assert.ok(!out.includes(LS) && !out.includes(PS), 'raw separators removed');
  assert.ok(out.includes('\\u2028') && out.includes('\\u2029'));
  assert.equal(JSON.parse(out), input);
});

test('rendered top-up page never contains a raw </script> from a hostile token', () => {
  const page = new StubPaymentProvider().renderTopUpPage({
    deviceToken: '</script><img src=x onerror=alert(1)>',
    packs: [{ id: 'pack100', questions: 100, amountCents: 900 }],
    currency: 'CNY',
    baseURL: 'http://localhost',
    lang: 'zh',
    stubEnabled: true,
  });
  const scriptOpen = page.indexOf('<script>');
  const body = page.slice(scriptOpen + '<script>'.length);
  const scriptClose = body.indexOf('</script>');
  assert.ok(scriptClose > 0);
  // No </script> injected by the token before the intended closing tag.
  assert.ok(!body.slice(0, scriptClose).includes('</script>'));
});

test('isValidTokenShape accepts dev_ base64url and rejects the rest', () => {
  assert.ok(isValidTokenShape('dev_36lju89rAfPJEn1AGZYoOb84iVc7m_R4'));
  assert.ok(!isValidTokenShape('dev_'));
  assert.ok(!isValidTokenShape('nope'));
  assert.ok(!isValidTokenShape('dev_</script>'));
  assert.ok(!isValidTokenShape(''));
});
