import { Progress } from '@/components/ui/progress';

export default function TrainingProgress({ materialsRead, materialCount, testsPassed, testCount }: {
  materialsRead: number; materialCount: number; testsPassed: number; testCount: number;
}) {
  const items = [
    { label: 'Материалы изучены', completed: materialsRead, total: materialCount, empty: 'Обязательные материалы не назначены' },
    { label: 'Тесты с зачётом', completed: testsPassed, total: testCount, empty: 'Обязательные тесты не назначены' },
  ];
  return <div className="training-progress" aria-label="Прогресс подготовки">
    {items.map(item => <div key={item.label} className={'training-progress-item' + (item.total > 0 && item.completed === item.total ? ' is-complete' : '')}>
      <div className="training-progress-label"><span>{item.label}</span><strong>{item.completed}<small> / {item.total}</small></strong></div>
      {item.total > 0 ? <Progress className="training-progress-bar" value={item.completed / item.total * 100} aria-label={item.label} aria-valuetext={`${item.completed} из ${item.total}`}/> : <p className="training-progress-empty">{item.empty}</p>}
    </div>)}
    <p className="training-progress-hint">Допуск подтверждает руководитель после выполнения программы.</p>
  </div>;
}
