import assert from 'node:assert/strict';
import { authFailureFeedback, validateAuthForm } from '../app/zhiyu/auth-validation.ts';

const valid = { username: 'fixture.user', password: 'synthetic-passphrase', confirmPassword: 'synthetic-passphrase' };
assert.deepEqual(validateAuthForm('register', valid), {});
assert.deepEqual(validateAuthForm('login', { ...valid, confirmPassword: '' }), {});
assert.deepEqual(Object.keys(validateAuthForm('register', { username: '', password: '', confirmPassword: '' })), ['username', 'password', 'confirmPassword']);
for (const username of ['five5', '1first', 'has space', 'a'.repeat(33), '账号名称中文']) {
  assert.ok(validateAuthForm('register', { ...valid, username }).username);
}
for (const username of ['a'.repeat(6), 'a'.repeat(32), '  trimmed.name  ', 'Alpha._-9']) {
  assert.deepEqual(validateAuthForm('register', { ...valid, username }), {});
}
assert.ok(validateAuthForm('login', { ...valid, password: 'short' }).password);
assert.deepEqual(validateAuthForm('register', { ...valid, password: 'a'.repeat(512), confirmPassword: 'a'.repeat(512) }), {});
assert.ok(validateAuthForm('register', { ...valid, password: 'a'.repeat(513), confirmPassword: 'a'.repeat(513) }).password);
assert.deepEqual(validateAuthForm('register', { ...valid, password: '字'.repeat(170), confirmPassword: '字'.repeat(170) }), {});
assert.ok(validateAuthForm('register', { ...valid, password: '字'.repeat(171), confirmPassword: '字'.repeat(171) }).password);
assert.equal(validateAuthForm('register', { ...valid, confirmPassword: 'different-passphrase' }).confirmPassword, '两次输入的密码不一致');
assert.deepEqual(authFailureFeedback('login', 401, '账号或密码不正确'), { fields: { password: '密码错误' }, error: '' });
for (const [status, message] of [[429, '尝试次数过多，请稍后再试'], [500, '登录服务暂时不可用'], [403, '请求来源无效']]) {
  assert.deepEqual(authFailureFeedback('login', status, message), { fields: {}, error: message });
}
assert.equal(authFailureFeedback('register', 409, '这个账号名已被使用').fields.username, '这个账号名已被使用');
assert.equal(authFailureFeedback('register', 400, '两次输入的密码不一致').fields.confirmPassword, '两次输入的密码不一致');
assert.equal(authFailureFeedback('register', 400, '密码至少 12 位，且不能过长').fields.password, '密码至少 12 位，且不能过长');
assert.deepEqual(authFailureFeedback('login', 502), { fields: {}, error: '操作未完成，请重试' });
console.log('Auth form constraints and failure classification passed (no network or account writes).');
