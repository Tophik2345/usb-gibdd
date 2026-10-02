import { useState } from 'react';
import { Download, RefreshCw, WifiOff } from 'lucide-react';
import { usePwa, installApp, applyAppUpdate } from '@/lib/pwa';
import './app-install.css';
export function AppStatus() {
  const state = usePwa(), [dismissed, setDismissed] = useState(false);
  return <aside className="app-install-footer" aria-label="Приложение УСБ"><a href="#install">Установить сайт на телефон</a>{!state.online && <p role="status"><WifiOff size={17}/>Нет соединения. Законы и памятки доступны без интернета; тестам и личным данным нужно соединение.</p>}{state.updateAvailable && !dismissed && <div className="app-update"><span>Доступно обновление сайта.</span><button type="button" className="button outline" onClick={applyAppUpdate}><RefreshCw size={16}/>Обновить приложение</button><button type="button" className="text-button" onClick={() => setDismissed(true)}>Позже</button></div>}</aside>;
}
export default function AppInstall() {
  const state = usePwa();
  return <section className="personal-tool app-install" aria-labelledby="install-title"><div className="eyebrow">БЫСТРЫЙ ДОСТУП К УСБ</div><h1 id="install-title">Установить сайт на телефон</h1><p>Добавьте значок на главный экран и открывайте сайт как отдельное приложение.</p>
    {state.installed ? <p className="install-status" role="status">Сайт уже открыт как установленное приложение.</p> : state.canInstall ? <button type="button" className="button primary" onClick={installApp}><Download size={18}/>Установить приложение УСБ</button> : <p className="helper">Если кнопка установки не появилась, воспользуйтесь меню браузера.</p>}
    {state.message && <p role="status">{state.message}</p>}<div className="install-instructions"><article><h2>Android</h2><ol><li>Откройте сайт в Chrome.</li><li>Нажмите меню ⋮ → «Установить приложение» или «Добавить на главный экран».</li><li>Подтвердите установку.</li></ol></article><article><h2>iPhone и iPad</h2><ol><li>Откройте сайт в Safari.</li><li>Нажмите «Поделиться» → «На экран “Домой”».</li><li>Подтвердите добавление.</li></ol></article><article><h2>На компьютере</h2><p>В Chrome или Edge нажмите значок установки в адресной строке либо выберите установку в меню браузера.</p></article></div><p className="helper">После первого открытия с интернетом приложение сохраняет публичные законы и памятки для чтения без соединения. Тесты, назначения, результаты и допуски загружаются с сервера при наличии интернета.</p><a href="#home" className="button outline">На главную</a>
  </section>;
}
