type AuthOperation = 'login' | 'register' | 'resend' | 'verify' | 'recovery' | 'verifyRecovery' | 'password';

/** Auth can report SMTP failures as a retryable HTTP 500 without an error code. */
export function authErrorMessage(error: unknown, operation: AuthOperation): string {
  const value = error && typeof error === 'object'
    ? error as { code?: string; status?: number; message?: string }
    : {};
  const messages: Record<string, string> = {
    username_exists: 'Этот логин уже занят. Выберите другой логин.',
    password_mismatch: 'Пароли не совпадают. Повторите новый пароль.',
    same_password: 'Новый пароль должен отличаться от предыдущего.',
    user_banned: 'Аккаунт заблокирован. Обратитесь к владельцу сайта.',
    recovery_session_missing: 'Подтверждение восстановления истекло. Запросите новый код.',
    signup_check_unavailable: 'Не удалось проверить логин. Попробуйте позже.',
    invalid_credentials: 'Неверный логин или пароль.',
    email_not_confirmed: 'Подтвердите почту кодом из письма, затем войдите.',
    user_already_exists: 'Аккаунт с этой почтой уже существует.',
    email_exists: 'Аккаунт с этой почтой уже существует.',
    email_address_invalid: 'Проверьте адрес электронной почты.',
    weak_password: 'Используйте более надёжный пароль: не менее 6 символов.',
    over_request_rate_limit: 'Слишком много попыток. Подождите и попробуйте снова.',
    over_email_send_rate_limit: 'Слишком много запросов писем. Попробуйте позже.',
    signup_disabled: 'Регистрация временно закрыта.',
    email_address_not_authorized: 'Отправка писем на этот адрес пока недоступна. Обратитесь к администратору сайта.',
    otp_expired: 'Код недействителен или срок его действия истёк. Запросите новый код.',
    otp_invalid: 'Введите цифровой код из последнего письма.',
    otp_disabled: 'Подтверждение кодом временно недоступно. Обратитесь к администратору сайта.',
    confirmation_session_missing: 'Не удалось завершить подтверждение. Попробуйте ещё раз или войдите в аккаунт, если почта уже подтверждена.',
  };
  if (operation === 'password' && ['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used'].includes(value.code || '')) return messages.recovery_session_missing;
  if (operation === 'register' && /error sending (confirmation|signup) email/i.test(value.message || '')) return 'Почтовая служба не смогла отправить код подтверждения. Попробуйте позже или обратитесь к администратору сайта.';
  if (operation === 'register' && /database error saving new user/i.test(value.message || '')) return 'Сервер не смог сохранить аккаунт. Попробуйте позже или обратитесь к администратору сайта.';
  if (operation === 'recovery' || operation === 'verifyRecovery' || operation === 'password') {
    if (value.code && messages[value.code]) return messages[value.code];
    if (value.status === 429) return 'Слишком много попыток. Подождите и попробуйте снова.';
    if (operation === 'verifyRecovery' && [400, 403, 422].includes(value.status || 0)) return 'Проверьте код из последнего письма или запросите новый код.';
    if ((value.status || 0) >= 500) return operation === 'password' ? 'Не удалось сохранить пароль. Попробуйте позже.' : 'Сервис восстановления или почтовая служба временно недоступны. Попробуйте позже.';
    if (operation === 'password') return 'Не удалось сохранить пароль. Проверьте соединение и повторите попытку.';
    return 'Не удалось завершить восстановление. Проверьте соединение и повторите попытку.';
  }
  if (operation === 'verify' && value.code === 'validation_failed') return messages.otp_invalid;
  if (operation === 'resend' && (value.status === 429 || value.code === 'over_email_send_rate_limit' || value.code === 'over_request_rate_limit')) {
    return 'Повторная отправка пока ограничена. Подождите немного и запросите код снова.';
  }
  if (value.code && messages[value.code]) return messages[value.code];
  if (value.status === 429) return 'Слишком много попыток. Попробуйте позже.';
  // A generic server failure does not prove that a username is occupied.
  if (value.code === 'unexpected_failure' || (value.status ?? 0) >= 500) {
    if (operation === 'resend') return 'Не удалось отправить код из-за ошибки сервера или почтовой службы. Попробуйте позже.';
    if (operation === 'verify') return 'Сервис подтверждения временно недоступен. Попробуйте позже.';
    return operation === 'register'
      ? 'Не удалось завершить регистрацию из-за ошибки сервера или отправки письма подтверждения. Обратитесь к администратору сайта.'
      : 'Сервис входа временно недоступен. Попробуйте позже.';
  }
  if (operation === 'verify' && [400, 403, 422].includes(value.status ?? 0)) {
    return 'Не удалось подтвердить почту. Проверьте адрес и код из последнего письма или запросите новый код.';
  }
  if (operation === 'resend' && [400, 403, 422].includes(value.status ?? 0)) {
    return 'Не удалось запросить код. Проверьте адрес электронной почты или попробуйте позже.';
  }
  if (operation === 'resend') return 'Не удалось запросить новый код. Проверьте соединение и попробуйте ещё раз.';
  if (operation === 'verify') return 'Не удалось подтвердить почту. Проверьте соединение и повторите попытку.';
  return operation === 'register'
    ? 'Не удалось связаться с сервером регистрации. Проверьте соединение и попробуйте ещё раз.'
    : 'Не удалось выполнить вход. Проверьте соединение и попробуйте ещё раз.';
}
