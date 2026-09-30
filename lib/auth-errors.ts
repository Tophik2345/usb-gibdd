type AuthOperation = 'login' | 'register';

/** Auth can report SMTP failures as a retryable HTTP 500 without an error code. */
export function authErrorMessage(error: unknown, operation: AuthOperation): string {
  const value = error && typeof error === 'object'
    ? error as { code?: string; status?: number }
    : {};
  const messages: Record<string, string> = {
    invalid_credentials: 'Неверный логин или пароль.',
    email_not_confirmed: 'Подтвердите почту по ссылке из письма, затем войдите.',
    user_already_exists: 'Аккаунт с этой почтой уже существует.',
    email_exists: 'Аккаунт с этой почтой уже существует.',
    email_address_invalid: 'Проверьте адрес электронной почты.',
    weak_password: 'Используйте более надёжный пароль: не менее 12 символов.',
    over_request_rate_limit: 'Слишком много попыток. Подождите и попробуйте снова.',
    over_email_send_rate_limit: 'Слишком много запросов писем. Попробуйте позже.',
    signup_disabled: 'Регистрация временно закрыта.',
    email_address_not_authorized: 'Отправка писем на этот адрес пока недоступна. Обратитесь к администратору сайта.',
  };
  if (value.code && messages[value.code]) return messages[value.code];
  if (value.status === 429) return 'Слишком много попыток. Попробуйте позже.';
  // A generic server failure does not prove that a username is occupied.
  if (value.code === 'unexpected_failure' || (value.status ?? 0) >= 500) {
    return operation === 'register'
      ? 'Не удалось завершить регистрацию из-за ошибки сервера или отправки письма подтверждения. Обратитесь к администратору сайта.'
      : 'Сервис входа временно недоступен. Попробуйте позже.';
  }
  return operation === 'register'
    ? 'Не удалось связаться с сервером регистрации. Проверьте соединение и попробуйте ещё раз.'
    : 'Не удалось выполнить вход. Проверьте соединение и попробуйте ещё раз.';
}
