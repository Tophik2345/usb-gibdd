import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Attempt } from '@/lib/types';
import QuestionExplanation from './question-explanation';
import ReportError from './report-error';
import './site-improvements.css';
export default function AnswerReview({ attempt }: { attempt: Attempt }) {
  const [filter, setFilter] = useState<'all' | 'wrong' | 'unanswered'>('wrong');
  if (!attempt.finishedAt) return null;
  const questions = attempt.questions || [];
  const wrong = questions.filter(item => attempt.answers?.[item.id] !== item.correct), unanswered = questions.filter(item => attempt.answers?.[item.id] === undefined);
  const shown = questions.map((item, index) => ({ item, index })).filter(({ item }) => filter === 'all' || (filter === 'unanswered' ? attempt.answers?.[item.id] === undefined : attempt.answers?.[item.id] !== item.correct));
  return <div className="answer-review"><div className="review-filters" role="group" aria-label="Фильтр разбора"><button type="button" className="button outline" aria-pressed={filter === 'wrong'} onClick={() => setFilter('wrong')}>Ошибки ({wrong.length})</button><button type="button" className="button outline" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все ответы ({questions.length})</button><button type="button" className="button outline" aria-pressed={filter === 'unanswered'} onClick={() => setFilter('unanswered')}>Без ответа ({unanswered.length})</button></div>
    {!shown.length && <p>{filter === 'wrong' ? 'Ошибок нет — все ответы верные.' : filter === 'unanswered' ? 'Вы ответили на все вопросы.' : 'Вопросы отсутствуют.'}</p>}
    {shown.map(({ item, index }) => { const chosen = attempt.answers?.[item.id], correct = chosen === item.correct; return <article className="review-item" key={item.id}><div><span className={'review-mark ' + (correct ? 'correct' : 'incorrect')}>{correct ? <Check size={16}/> : <X size={16}/>}</span><h3>{index + 1}. {item.text}</h3></div><p>Ваш ответ: <strong>{chosen !== undefined ? item.options[chosen] : 'Нет ответа'}</strong></p>{!correct && <p className="correct-answer">Верный ответ: {item.correct !== undefined ? item.options[item.correct] : 'Не указан в сохранённой попытке'}</p>}{item.explanation ? <QuestionExplanation text={item.explanation}/> : <p className="helper">Автор не добавил пояснение к этому вопросу. Можно сообщить о неточности или обратиться к руководителю.</p>}{!attempt.readOnly && <ReportError target={{ kind: 'question', attemptId: attempt.id, questionId: item.id, label: item.text }}/>}</article>; })}
  </div>;
}
