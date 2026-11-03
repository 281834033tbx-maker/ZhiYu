export type UserFacingErrorKind='send'|'save'|'load'|'media';
export const userFacingErrors={
  network:'网络不太好，消息没发出去',
  unavailable:'出了点问题，稍后再试',
  save:'没保存上，再试一次',
} as const;

/** Technical details belong in diagnostics; this is the only text shown by UI. */
export function userFacingError(cause:unknown,kind:UserFacingErrorKind='send'):string {
  if(kind==='save')return userFacingErrors.save;
  const detail=cause instanceof Error?cause.message:typeof cause==='string'?cause:'';
  if(/network|fetch|econn|enotfound|timeout|timed out|socket|网络|超时|服务.{0,8}(?:未启动|未连接|不可用)/iu.test(detail))return userFacingErrors.network;
  return userFacingErrors.unavailable;
}

export function reportUserFacingError(cause:unknown,kind:UserFacingErrorKind='send',scope='界面操作'):string {
  console.error('[智域] '+scope,cause);
  return userFacingError(cause,kind);
}

/** Validation is local product copy; never expose a transport/provider exception. */
export function userFacingValidationMessage(cause:unknown):string {
  const text=typeof cause==='string'?cause:cause&&typeof cause==='object'&&'message'in cause&&typeof cause.message==='string'?cause.message:'';
  if(text.length<=160&&/^(?:请|至少|最多|不能|需要|格式|输入|选择|姓名|名字|密码|邮箱|手机|长度|必填|验证码)/u.test(text)&&!/[\r\n]|https?:|\b(?:error|exception|stack|sql|codex|deepseek|prompt|npc)\b|\.json|\.md|user_required|模型|本地服务|AI\s*生成/iu.test(text))return text;
  return '请检查填写的内容';
}
