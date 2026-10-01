import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { workspaceApi } from '@/lib/workspace-api';
import { fromSiteDateTimeInput, toSiteDateTimeInput, SITE_TIME_LABEL } from '@/lib/date-time';
import type { Assignment } from '@/lib/types';

export default function AssignmentReset({ assignment, onClose, onSuccess, onReload }: {
  assignment: Assignment; onClose: () => void; onSuccess: () => void; onReload: () => void;
}) {
  const [due, setDue] = useState(toSiteDateTimeInput(new Date(Date.now() + 86400_000)));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving || conflict) return;
    setSaving(true); setError('');
    try {
      await workspaceApi('', { action: 'resetAssignment', id: assignment.id, version: assignment.version, dueAt: fromSiteDateTimeInput(due) });
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось обнулить назначение.');
      setConflict(cause instanceof Error && 'status' in cause && cause.status === 409);
    } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="portal-dialog" onInteractOutside={event => { if (saving) event.preventDefault(); }} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Обнулить назначение?</DialogTitle><DialogDescription>«{assignment.testTitle}» · {assignment.employeeLogin}. Все попытки, ответы и результаты сохранятся. Сотрудник получит новое задание для повторного прохождения актуальной версии теста.</DialogDescription></DialogHeader>
      <form className="portal-form" onSubmit={save}>
        <label className="field">Новый срок сдачи<input aria-label="Новый срок сдачи" type="datetime-local" required disabled={saving || conflict} min={toSiteDateTimeInput(new Date())} value={due} onChange={event => setDue(event.target.value)} /><small>{SITE_TIME_LABEL}</small></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="portal-actions"><button type="button" className="button outline" disabled={saving} onClick={onClose}>Отмена</button>
          {conflict ? <button type="button" className="button primary" onClick={onReload}>Обновить задания</button> : <button type="submit" className="button primary" disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <RotateCcw size={17} />}Обнулить назначение</button>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
