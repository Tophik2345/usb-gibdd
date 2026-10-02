import { BookOpen, ChartNoAxesCombined, ClipboardCheck, LayoutGrid, SlidersHorizontal, Users } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function TestNavigation({ pending, dashboard, analysis, editing, access }: {
  pending: number; dashboard: boolean; analysis: boolean; editing: boolean; access: boolean;
}) {
  return <div className="nav-row test-tools">
    <TabsList className="main-nav test-navigation" variant="line" aria-label="Разделы тестирования">
      <div className="test-tabs-primary">
        <TabsTrigger value="tests" aria-label="Доступные тесты"><BookOpen aria-hidden="true"/>Тесты</TabsTrigger>
        <TabsTrigger value="assignments" aria-label={pending > 0 ? `Задания (${pending})` : 'Задания'}><ClipboardCheck aria-hidden="true"/>Задания{pending > 0 && <span className="count-pill" aria-hidden="true" title={`Ожидают сдачи: ${pending}`}>{pending > 99 ? '99+' : pending}</span>}</TabsTrigger>
        <TabsTrigger value="results"><ChartNoAxesCombined aria-hidden="true"/>Результаты</TabsTrigger>
      </div>
      {(dashboard || analysis || editing || access) && <div className="test-tabs-secondary">
        {dashboard && <TabsTrigger value="dashboard"><LayoutGrid aria-hidden="true"/>Сводка</TabsTrigger>}
        {analysis && <TabsTrigger value="analytics"><ChartNoAxesCombined aria-hidden="true"/>Анализ ошибок</TabsTrigger>}
        {editing && <TabsTrigger value="manage"><SlidersHorizontal aria-hidden="true"/>Управление</TabsTrigger>}
        {access && <TabsTrigger value="access"><Users aria-hidden="true"/>Доступ</TabsTrigger>}
      </div>}
    </TabsList>
  </div>;
}
