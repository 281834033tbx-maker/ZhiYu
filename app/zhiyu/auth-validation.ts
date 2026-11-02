export type AuthFormView = 'login' | 'register';
export type AuthFieldName = 'username' | 'password' | 'confirmPassword';
export type AuthFieldErrors = Partial<Record<AuthFieldName, string>>;
export type AuthFormValues = Record<AuthFieldName, string>;

const USERNAME = /^[A-Za-z][A-Za-z0-9._-]{5,31}$/;
const USERNAME_MESSAGE = '账号须以字母开头，包含 6-32 位字母、数字、点、下划线或短横线';
const PASSWORD_MESSAGE = '密码至少 12 位，且不能过长';
const CONFIRM_MESSAGE = '两次输入的密码不一致';

export function validateAuthForm(view: AuthFormView, values: AuthFormValues): AuthFieldErrors {
  const fields: AuthFieldErrors = {};
  if (!values.username.trim()) fields.username = '请输入账号名称';
  else if (!USERNAME.test(values.username.trim())) fields.username = USERNAME_MESSAGE;
  if (!values.password) fields.password = '请输入密码';
  else if (values.password.length < 12) fields.password = '密码至少 12 位';
  else if (view === 'register' && new TextEncoder().encode(values.password).byteLength > 512) fields.password = PASSWORD_MESSAGE;
  if (view === 'register') {
    if (!values.confirmPassword) fields.confirmPassword = '请再次输入密码';
    else if (values.password !== values.confirmPassword) fields.confirmPassword = CONFIRM_MESSAGE;
  }
  return fields;
}

// Keep credential failures generic on the server. Only the form's presentation
// changes; neither this mapper nor the response reveals whether an account exists.
export function authFailureFeedback(view: AuthFormView, status: number, message?: string): {
  fields: AuthFieldErrors;
  error: string;
} {
  if (view === 'login' && status === 401) return { fields: { password: '密码错误' }, error: '' };
  if (status === 400 && message === USERNAME_MESSAGE) return { fields: { username: message }, error: '' };
  if (view === 'register' && status === 400 && message === PASSWORD_MESSAGE) return { fields: { password: message }, error: '' };
  if (view === 'register' && status === 400 && message === CONFIRM_MESSAGE) return { fields: { confirmPassword: message }, error: '' };
  if (view === 'register' && status === 409 && message === '这个账号名已被使用') return { fields: { username: message }, error: '' };
  return { fields: {}, error: message || '操作未完成，请重试' };
}
